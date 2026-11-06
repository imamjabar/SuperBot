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
