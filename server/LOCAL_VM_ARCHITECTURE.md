# Local VM desktop architecture

## Image

`managedImageDockerfile()` in `container-computer.ts` generates the image. CI builds it
in `.github/workflows/desktop-image.yml` for `linux/amd64`. A VPS runs that build through
`OMB_LOCAL_VM_IMAGE`, pinned by digest.

- Base: Debian 13 (trixie), pinned by the multi-architecture index digest.
- Runtime: tini (PID 1) starts supervisord. Python 3.13 comes from Debian, with a venv for
  the SHA-256-checked Cua Driver wheel. Node 24 comes from the official tarball, checked
  by SHA-256. The image also has git, gh, PulseAudio and picom.
- Browser: Google Chrome stable from Google's apt repository. The repository key is
  checked by SHA-256. Chrome is installed on amd64 only. On any other architecture the
  build fails, and no substitute browser is installed. Chrome is the default browser.
  It runs visibly (not headless) and with `--no-sandbox`, because the hardened container
  refuses the namespaces Chrome's own sandbox needs. Its profile is stored at
  `/home/cua/workspace/.browser-profiles/google-chrome`.
- User: uid/gid 1000 `cua` runs every seat process. The workspace bind mount is the only
  writable host data.

## Seats

Seat `N` (1–3) runs these programs:

| Program | Seat 1 | Seat N |
|---|---|---|
| Xvfb | `:1`, 1280x800x24 | `:N` |
| XFCE (xfwm4, panel), picom, PulseAudio | `XDG_RUNTIME_DIR=/run/user/1000` | `/run/user/1000/seat-N` |
| x11vnc | `127.0.0.1:5901` | `127.0.0.1:590N` |
| noVNC (websockify) | `6901` | `690N` |
| Cua Driver socket | `/run/user/1000/openmausbot-cua.sock` | `/run/user/1000/openmausbot-cua-N.sock` |

The image starts seat 1. Run `openmausbot-start-seat N` as root inside the container to
start seat N: it writes `/etc/supervisor/conf.d/seat-N.conf` and runs `supervisorctl
update`. Any seat number outside 1–3 is rejected. Each log is capped at 1 MB.

x11vnc uses a read-only `~/.vnc/passwd` with `-rfbauth` when that file exists. If it
does not, x11vnc uses `VNC_PW` from the environment. With neither, it runs `-nopw`, which
is safe only on loopback behind the app's authenticated viewer proxy.

The server drives seats in the one shared container with `server/container-seats.ts`;
it never creates a container per bot. The helpers run `docker exec -u root`, except the socket check:

- `containerStartSeat(N)` runs `openmausbot-start-seat N`. Running it again is a no-op,
  because supervisor applies only changed config.
- `containerStopSeat(N)` deletes `seat-N.conf` and runs `supervisorctl update`. Seat 1
  is refused.
- `containerSeatStatus(N)` reports the supervisor state of the seat's five programs, and,
  through `docker exec -u cua`, whether its Cua socket exists: root has no DAC override in
  the container and cannot look inside cua's 0700 `/run/user/1000`.

`cuaExecArgs`, `containerExec`, `containerComputerFrame` and `containerComputerMcp` take an
optional seat. A seat sets `DISPLAY=:N`, the seat's `XDG_RUNTIME_DIR` and its socket, so a
bridge only ever gets its own seat's socket. With no seat, they keep the seat-1 behavior.

Only seat 1's viewer is published, on the host's `:6080`. For other seats,
`containerSeatStatus` returns `viewerUrl: null` until the app proxy (task 7) serves them.
`VNC_PW` reaches each seat's x11vnc through supervisord's environment and never appears
in command arguments.

### Thread binding

`localVm.seats` in `config.json` (1–3, default 1) sets how many threads can use the
shared desktop at once. Only shared mode reads it. With 1, turns lock the whole desktop,
as before.

With more than one seat, a turn gets a seat for its thread from a `SeatLeaseTable` (owner
is the bot, key is the thread). That seat is its target's `seat`, and only the server
chooses it; no tool argument picks a seat.

- The same thread gets the same seat again; no other thread can take it.
- A turn that finds no free seat gets a clear error and does not wait in a queue.
- The turn lock key is `shared` for seat 1 and `shared#seat:N` for other seats. Lifecycle
  actions on the container treat any held seat as in use.
- Before Cua is attached, `ensureContainerSeat` starts the seat and waits until it is up.
- The MCP bridge, preview screenshots and the bot's command route all use the turn's seat.
- Every event on the thread renews its lease (30 min TTL), and the lease is released when
  the turn ends. The seat's programs keep running.

The inventory endpoint reports `seats: { capacity, busy, running }`.

### Seat idle shutdown

Each extra seat has its own idle window (`localVm.idleTimeoutMinutes`), run by
`SeatIdleRegistry`. Thread events, seat starts and the bot's commands on that seat renew
it.

- **When the window ends:** a seat held by a turn is checked again every tenth of a
  window. Once it is free, it gets a full quiet window before it stops. To stop it, the
  server sends SIGTERM only to Chrome processes on that seat's display, waits at most
  10 seconds, then deletes `seat-N.conf` and runs `supervisorctl update`. The workspace
  and profiles are not touched.
- **A turn takes the seat during the stop:** the turn waits for the stop to finish, then
  starts the seat again, and the seat's idle window keeps running.
- **Seat 1 and the container:** seat 1 is the container itself. The machine's idle timer
  treats the container as busy while any seat is leased or any extra seat is running. So
  the container stops (and keeps its workspace) only after every seat is idle. Its stop
  clears all seat windows.

### Seat viewer and takeover

Extra seats use the existing authenticated desktop proxy,
`/api/desktop-viewer/local/shared-seat-N` (N = 2 or 3). Seat 1 stays `local/shared`. Each
bot's Local VM status carries its `seat`, and its `viewer_url` points at that seat, so
"Open live desktop" opens the thread's own display.

- **Access:** admin scope, same origin and a live session, as for every desktop viewer. A
  seat held by a turn is also limited to people who can see that turn's bot. Access is
  checked again every 5 seconds, and signing out closes the stream.
- **No new port:** an extra seat publishes no host port. The proxy opens `exec -i -u cua …
  python3` in the shared container, which relays bytes to `127.0.0.1:690N`. The relay
  starts only after the seat's supervisor programs show as running.
- **Password:** the noVNC password is the container's `VNC_PW`. It goes only to the
  authenticated same-origin JSON answer that the app's own noVNC client needs; it is never
  put in a URL or log.
- **Takeover:** this is the bot's existing computer control lease (`/api/bots/:id/computer/
  control` and `…/local-computer/join`). A lease-bound viewer is accepted for a seat only
  while that bot's thread holds the seat, and for `local/shared` only when seats > 1. The
  person then has the seat to themselves: the bot's Cua calls and commands wait at the
  existing control gate until the person releases it.
- **Watch-only:** every new container gets a random `VNC_VIEW_PW` next to `VNC_PW`. Image
  layer 10 writes it after `__BEGIN_VIEWONLY__` in the seat's x11vnc password file, so
  x11vnc itself refuses input from that password. An extra seat opened without a control
  lease receives only the view-only password (`viewOnly: true`). A container from image
  layer 9 or older has no view-only password, so an extra seat there opens only with a
  control lease. Seat 1 keeps the full password, as before.

## Sizing (VPS: 2 vCPU, 8 GB RAM, 77 GB disk)

- Reserve 1.5 GB for the OS, omb and Caddy.
- Plan for 600 MB–1 GB per active seat running Chrome, inside the container's 4 GiB
  limit.
- Run at most three seats. Raise the seat count only after measuring it in task 9.

## Network and storage

- Ports: never publish a host port publicly. Viewer ports bind to `127.0.0.1` and are
  reached only through the app's authenticated `/api/desktop-viewer` proxy. Chrome's CDP
  port, when used, listens on `127.0.0.1` inside the container only.
- Storage: each target bind-mounts its own `vm-home`. The host side tolerates a workspace
  directory owned by uid 1000 when the app runs as another uid (`ensureVmWorkspace`).
  Mount private bot data read-only and separately.
- Egress: an egress proxy is required, but this release does not implement it. Later,
  the container's outbound traffic will be forced through a proxy on an internal Docker
  network that has no direct route out. Chrome and the driver will get
  `HTTP(S)_PROXY`, and the proxy will refuse private and metadata addresses.

## Roadmap (tasks 3–9)

| Task | Scope |
|---|---|
| 3 | Seat leases: map bots to seats 1–3 in the server |
| 4 | Server starts and stops seats with `openmausbot-start-seat` |
| 5 | Per-seat viewer routing in the authenticated proxy |
| 6 | Read-only private bot data mounts |
| 7 | Egress proxy network |
| 8 | Per-seat Chrome profiles and CDP on loopback |
| 9 | Measure RAM and CPU per seat, then raise the seat cap |
