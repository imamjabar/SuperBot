import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { SHARED_LOCAL_VM_TARGET, sh, type CommandRunner, type LocalVmTarget, type Runtime } from "./container-computer.ts";
import { augmentedPath, resolveCliSpawn } from "./env-path.ts";
import { seatIdentity, type SeatIdentity } from "./local-vm-seats.ts";

/** Copies bytes between stdio and the seat's websockify on the container's loopback; websockify ships python3. */
const VIEWER_RELAY = [
  "import os, socket, sys, threading",
  "s = socket.create_connection(('127.0.0.1', int(sys.argv[1])))",
  "def up():",
  "    while True:",
  "        d = os.read(0, 65536)",
  "        if not d:",
  "            s.shutdown(socket.SHUT_WR)",
  "            return",
  "        s.sendall(d)",
  "threading.Thread(target=up, daemon=True).start()",
  "while True:",
  "    d = s.recv(65536)",
  "    if not d:",
  "        break",
  "    os.write(1, d)",
].join("\n");

/** Seats other than 1 publish no host port, so their viewer is reached through `exec -i` instead of a new listener. */
export function seatViewerTunnelArgs(seat: number, container = SHARED_LOCAL_VM_TARGET.containerName): string[] {
  const { viewerPort } = seatIdentity(seat);
  return ["exec", "-i", "-u", "cua", container, "python3", "-c", VIEWER_RELAY, String(viewerPort)];
}

export function openSeatViewerTunnel(runtime: Runtime, seat: number, container = SHARED_LOCAL_VM_TARGET.containerName): Duplex {
  const resolved = resolveCliSpawn(runtime, seatViewerTunnelArgs(seat, container));
  const child = spawn(resolved.command, resolved.args, { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, PATH: augmentedPath() } });
  const { stdin, stdout } = child;
  const stream = new Duplex({
    read() { stdout.resume(); },
    write(chunk, _encoding, done) { stdin.write(chunk, done); },
    final(done) { stdin.end(done); },
    destroy(error, done) {
      stdout.destroy();
      stdin.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      done(error);
    },
  });
  stdout.on("data", (chunk: Buffer) => { if (!stream.push(chunk)) stdout.pause(); });
  stdout.once("end", () => stream.push(null));
  stdout.once("error", (error) => stream.destroy(error));
  stdin.once("error", (error) => stream.destroy(error));
  child.once("error", (error) => stream.destroy(error));
  child.once("close", () => stream.destroy());
  return stream;
}

const SUPERVISOR_CONF = "/etc/supervisor/supervisord.conf";
const SOCKET_READY = "openmausbot-seat-socket-ready";

/** Program names written by the image's `openmausbot-seat-conf`. */
export function seatPrograms(seat: number): string[] {
  const suffix = seatIdentity(seat).seat === 1 ? "" : `-${seat}`;
  return ["xvfb", "xfce", "vncserver", "novnc", "openmausbot-cua-driver"].map((name) => `${name}${suffix}`);
}

export interface SeatRuntimeOptions {
  runtime: Runtime;
  target?: LocalVmTarget;
  runner?: CommandRunner;
}

export interface ContainerSeatStatus {
  seat: SeatIdentity;
  programs: Record<string, string>;
  socketReady: boolean;
  running: boolean;
  /** Always null: only seat 1's viewer is published, and other seats wait for the app proxy. */
  viewerUrl: null;
}

function rootExec(container: string, args: string[]): string[] {
  return ["exec", "-u", "root", container, ...args];
}

export function containerStartSeatArgs(seat: number, container = SHARED_LOCAL_VM_TARGET.containerName): string[] {
  return rootExec(container, ["/usr/local/bin/openmausbot-start-seat", String(seatIdentity(seat).seat)]);
}

const CHROME_QUIT_SECONDS = 10;

/** Chrome writes its profile on SIGTERM, so only Chrome processes whose environment names this seat's display get
 * one, with a bounded wait, before supervisor stops the seat's programs. */
const STOP_SEAT_SCRIPT = [
  'pids=""',
  "for dir in /proc/[0-9]*; do",
  '  case "$(cat "$dir/comm" 2>/dev/null)" in chrome|chromium) ;; *) continue ;; esac',
  '  tr "\\0" "\\n" < "$dir/environ" 2>/dev/null | grep -qx "DISPLAY=:$1" && pids="$pids ${dir#/proc/}"',
  "done",
  '[ -z "$pids" ] || kill -TERM $pids 2>/dev/null || true',
  `waited=0`,
  `while [ -n "$pids" ] && [ "$waited" -lt ${CHROME_QUIT_SECONDS} ]; do`,
  '  alive=""',
  '  for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done',
  '  pids=$alive',
  '  [ -z "$pids" ] || { sleep 1; waited=$((waited + 1)); }',
  "done",
  `rm -f "/etc/supervisor/conf.d/seat-$1.conf" && exec supervisorctl -c ${SUPERVISOR_CONF} update`,
].join("\n");

export function containerStopSeatArgs(seat: number, container = SHARED_LOCAL_VM_TARGET.containerName): string[] {
  if (seatIdentity(seat).seat === 1) throw new Error("Seat 1 is the shared desktop and cannot be stopped on its own");
  return rootExec(container, ["sh", "-c", STOP_SEAT_SCRIPT, "sh", String(seat)]);
}

export function containerSeatStatusArgs(seat: number, container = SHARED_LOCAL_VM_TARGET.containerName): string[] {
  return rootExec(container, [
    "sh", "-c",
    `socket="$1"; shift; supervisorctl -c ${SUPERVISOR_CONF} status "$@" || true; if test -S "$socket"; then echo ${SOCKET_READY}; fi`,
    "sh", seatIdentity(seat).cuaSocket, ...seatPrograms(seat),
  ]);
}

export function parseSeatStatus(seat: number, stdout: string): ContainerSeatStatus {
  const names = seatPrograms(seat);
  const programs: Record<string, string> = Object.fromEntries(names.map((name) => [name, "MISSING"]));
  let socketReady = false;
  for (const line of stdout.split("\n")) {
    const [name, state] = line.trim().split(/\s+/);
    if (name === SOCKET_READY) socketReady = true;
    else if (name && state && names.includes(name)) programs[name] = state;
  }
  return {
    seat: seatIdentity(seat),
    programs,
    socketReady,
    running: socketReady && names.every((name) => programs[name] === "RUNNING"),
    viewerUrl: null,
  };
}

/** Supervisor applies only changed config, so starting a running seat is a no-op. VNC_PW reaches the seat's
 * x11vnc through supervisord's own environment and is never part of these arguments. */
export async function containerStartSeat(seat: number, options: SeatRuntimeOptions): Promise<void> {
  const { runtime, target = SHARED_LOCAL_VM_TARGET, runner = sh } = options;
  await runner(runtime, containerStartSeatArgs(seat, target.containerName), 30_000);
}

export async function containerStopSeat(seat: number, options: SeatRuntimeOptions): Promise<void> {
  const { runtime, target = SHARED_LOCAL_VM_TARGET, runner = sh } = options;
  await runner(runtime, containerStopSeatArgs(seat, target.containerName), 30_000);
}

export async function containerSeatStatus(seat: number, options: SeatRuntimeOptions): Promise<ContainerSeatStatus> {
  const { runtime, target = SHARED_LOCAL_VM_TARGET, runner = sh } = options;
  const { stdout } = await runner(runtime, containerSeatStatusArgs(seat, target.containerName), 15_000);
  return parseSeatStatus(seat, stdout);
}

const SEAT_START_SECONDS = 45;

/** Starts the target's seat when it is not fully up and waits until its programs run and its socket exists.
 * Seat 1 is the container's own desktop and is never touched here. */
export async function ensureContainerSeat(
  target: LocalVmTarget,
  options: { runtime: Runtime; runner?: CommandRunner; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const { seat } = target;
  if (seat === undefined || seat === 1) return;
  const { runtime, runner = sh, sleep = (ms: number) => delay(ms) } = options;
  const seatOptions = { runtime, target, runner };
  if ((await containerSeatStatus(seat, seatOptions)).running) return;
  await containerStartSeat(seat, seatOptions);
  for (let attempt = 0; attempt < SEAT_START_SECONDS; attempt++) {
    await sleep(1_000);
    if ((await containerSeatStatus(seat, seatOptions)).running) return;
  }
  throw new Error(`Local VM seat ${seat} did not start within ${SEAT_START_SECONDS} seconds`);
}
