import { SHARED_LOCAL_VM_TARGET, sh, type CommandRunner, type LocalVmTarget, type Runtime } from "./container-computer.ts";
import { seatIdentity, type SeatIdentity } from "./local-vm-seats.ts";

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

export function containerStopSeatArgs(seat: number, container = SHARED_LOCAL_VM_TARGET.containerName): string[] {
  if (seatIdentity(seat).seat === 1) throw new Error("Seat 1 is the shared desktop and cannot be stopped on its own");
  return rootExec(container, [
    "sh", "-c",
    `rm -f "/etc/supervisor/conf.d/seat-$1.conf" && exec supervisorctl -c ${SUPERVISOR_CONF} update`,
    "sh", String(seat),
  ]);
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
