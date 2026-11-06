import { describe, expect, it } from "vitest";

import { PassThrough } from "node:stream";
import { CONTAINER, SHARED_LOCAL_VM_TARGET, containerComputerMcp, containerExec, containerRunArgs, cuaExecArgs, managedImageDockerfile, type CommandRunner, type ContainerComputerStatus } from "./container-computer.ts";
import { containerSeatStatus, containerStartSeat, containerStopSeat, ensureContainerSeat, parseSeatStatus, seatPrograms, startSeatLifecycle } from "./container-seats.ts";
import { SeatIdleRegistry } from "./local-vm-seat-idle.ts";
import { seatDesktopTarget } from "./desktop-viewer-targets.ts";
import { SeatLeaseTable, localVmSeatKey } from "./local-vm-seats.ts";

function recorder(stdout = ""): { runner: CommandRunner; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  return { calls, runner: async (command, args) => { calls.push({ command, args }); return { stdout }; } };
}

describe("seat runtime commands", () => {
  it("starts a seat as root through the image's start-seat script in the shared container", async () => {
    const { runner, calls } = recorder();
    await containerStartSeat(2, { runtime: "docker", runner });
    expect(calls).toEqual([{ command: "docker", args: ["exec", "-u", "root", CONTAINER, "/usr/local/bin/openmausbot-start-seat", "2"] }]);
  });

  it("stops a seat by removing only its supervisor config, and never stops seat 1", async () => {
    const { runner, calls } = recorder();
    await containerStopSeat(3, { runtime: "docker", runner });
    expect(calls[0]!.args.slice(0, 6)).toEqual(["exec", "-u", "root", CONTAINER, "sh", "-c"]);
    const script = calls[0]!.args[6]!;
    expect(script).toContain('rm -f "/etc/supervisor/conf.d/seat-$1.conf"');
    expect(script.indexOf('grep -qx "DISPLAY=:$1"')).toBeGreaterThan(-1);
    expect(script.indexOf("kill -TERM")).toBeLessThan(script.indexOf("rm -f"));
    expect(script).not.toMatch(/pkill|killall|rm -rf/);
    expect(calls[0]!.args.slice(7)).toEqual(["sh", "3"]);
    await expect(containerStopSeat(1, { runtime: "docker", runner })).rejects.toThrow(/Seat 1/);
    expect(calls).toHaveLength(1);
  });

  it("rejects seats outside 1..3 before running anything", async () => {
    const { runner, calls } = recorder();
    await expect(containerStartSeat(4, { runtime: "docker", runner })).rejects.toThrow();
    await expect(containerSeatStatus(0, { runtime: "docker", runner })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("reports a seat running only when every program runs and cua sees its socket", async () => {
    const programs = seatPrograms(2);
    expect(programs).toEqual(["xvfb-2", "xfce-2", "vncserver-2", "novnc-2", "openmausbot-cua-driver-2"]);
    const running = programs.map((name) => `${name}   RUNNING   pid 1, uptime 0:00:05`).join("\n");
    const calls: string[][] = [];
    const runner = (socket: string): CommandRunner => async (_command, args) => {
      calls.push(args);
      return { stdout: args[2] === "cua" ? socket : running };
    };
    const status = await containerSeatStatus(2, { runtime: "docker", runner: runner("openmausbot-seat-socket-ready\n") });
    expect(calls[0]!.slice(0, 4)).toEqual(["exec", "-u", "root", CONTAINER]);
    expect(calls[0]!.slice(-5)).toEqual(programs);
    expect(calls[1]!.slice(0, 4)).toEqual(["exec", "-u", "cua", CONTAINER]);
    expect(calls[1]!.at(-1)).toBe("/run/user/1000/openmausbot-cua-2.sock");
    expect(status).toMatchObject({ running: true, socketReady: true, viewerUrl: null, seat: { viewerPort: 6902 } });
    expect(await containerSeatStatus(2, { runtime: "docker", runner: runner("") })).toMatchObject({ running: false, socketReady: false });
    expect(parseSeatStatus(2, "xvfb-2 FATAL\nopenmausbot-seat-socket-ready").programs).toMatchObject({ "xvfb-2": "FATAL", "xfce-2": "MISSING" });
  });
});

describe("seat selection in exec helpers", () => {
  it("keeps the original seat-1 environment when no seat is given", () => {
    expect(cuaExecArgs(["status"])).toEqual(expect.arrayContaining(["DISPLAY=:1"]));
    expect(cuaExecArgs(["status"]).some((arg) => arg.startsWith("XDG_RUNTIME_DIR="))).toBe(false);
  });

  it("points Cua at the seat's display and private runtime dir", () => {
    const args = cuaExecArgs(["status"], { seat: 3 });
    expect(args).toContain("DISPLAY=:3");
    expect(args).toContain("XDG_RUNTIME_DIR=/run/user/1000/seat-3");
    expect(args).not.toContain("DISPLAY=:1");
  });

  it("hands the MCP bridge only its own seat's socket", () => {
    expect(containerComputerMcp("docker").args.slice(1)).toEqual(["docker", CONTAINER, "/run/user/1000/openmausbot-cua.sock"]);
    const launch = containerComputerMcp("docker", undefined, undefined, 2);
    expect(launch.args.slice(1)).toEqual(["docker", CONTAINER, "/run/user/1000/openmausbot-cua-2.sock", "2"]);
    expect(launch.args.join(" ")).not.toMatch(/openmausbot-cua(-3)?\.sock/);
  });

  it("runs commands on the seat's display", async () => {
    const seen: string[][] = [];
    await containerExec({ key: "shared", containerName: CONTAINER, workspaceDir: "/tmp", viewerPort: null, label: "shared" }, "true", {
      runtime: "docker",
      seat: 2,
      exec: async (_command, args) => { seen.push(args); return { code: 0, stdout: "", stderr: "" }; },
    });
    expect(seen[0]).toContain("DISPLAY=:2");
    expect(seen[0]).toContain("XDG_RUNTIME_DIR=/run/user/1000/seat-2");
  });
});

describe("ensureContainerSeat", () => {
  const running = (seat: number) =>
    `${seatPrograms(seat).map((name) => `${name} RUNNING`).join("\n")}\nopenmausbot-seat-socket-ready`;

  it("never touches seat 1", async () => {
    const { runner, calls } = recorder();
    await ensureContainerSeat(SHARED_LOCAL_VM_TARGET, { runtime: "docker", runner });
    await ensureContainerSeat({ ...SHARED_LOCAL_VM_TARGET, seat: 1 }, { runtime: "docker", runner });
    expect(calls).toEqual([]);
  });

  it("leaves a running seat alone", async () => {
    const { runner, calls } = recorder(running(2));
    await ensureContainerSeat({ ...SHARED_LOCAL_VM_TARGET, seat: 2 }, { runtime: "docker", runner });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).not.toContain("/usr/local/bin/openmausbot-start-seat");
  });

  it("starts a stopped seat and waits for it", async () => {
    const outputs = ["", "", running(3)];
    const calls: string[][] = [];
    const runner: CommandRunner = async (_command, args) => { calls.push(args); return { stdout: args.includes("/usr/local/bin/openmausbot-start-seat") ? "" : outputs.shift() ?? "" }; };
    await ensureContainerSeat({ ...SHARED_LOCAL_VM_TARGET, seat: 3 }, { runtime: "docker", runner, sleep: async () => {} });
    expect(calls.filter((args) => args.includes("/usr/local/bin/openmausbot-start-seat"))).toEqual([
      ["exec", "-u", "root", CONTAINER, "/usr/local/bin/openmausbot-start-seat", "3"],
    ]);
  });

  it("gives up when the seat never comes up", async () => {
    const { runner } = recorder();
    await expect(ensureContainerSeat({ ...SHARED_LOCAL_VM_TARGET, seat: 2 }, { runtime: "docker", runner, sleep: async () => {} }))
      .rejects.toThrow(/seat 2 did not start/);
  });

  it("starts a turn's seat on its first command, so the viewer then finds it running with its credentials", async () => {
    let started = false;
    const runner: CommandRunner = async (_command, args) => {
      if (args.includes("/usr/local/bin/openmausbot-start-seat")) started = true;
      return { stdout: started && !args.includes("/usr/local/bin/openmausbot-start-seat") ? running(2) : "" };
    };
    const idle = new SeatIdleRegistry({ idleMs: () => 900_000, inUse: () => true, stop: async () => {} });
    const seat = { ...SHARED_LOCAL_VM_TARGET, seat: 2 };
    const viewer = seatDesktopTarget(seat, {
      status: async () => ({
        managed: true, imageMatches: true, network: "loopback", container: "running", runtime: "docker", viewer_port: 1,
        viewer_url: "http://127.0.0.1:1/vnc.html#password=full&view_password=watch",
      }) as ContainerComputerStatus,
      seatStatus: (runtime, n) => containerSeatStatus(n, { runtime, runner }),
      tunnel: () => new PassThrough(),
      touch: () => {},
    });
    try {
      await expect(viewer.resolve()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/seat 2 is not running \(xvfb-2 MISSING, .*no Cua socket\)/) });
      await startSeatLifecycle(seat, idle, { runtime: "docker", runner, sleep: async () => {} });
      expect(started).toBe(true);
      expect(idle.alive()).toEqual([2]);
      expect(await viewer.resolve()).toMatchObject({ password: "full", viewPassword: "watch" });
    } finally {
      idle.forgetAll();
    }
  });

  it("never lists a seat as running when it did not come up", async () => {
    const { runner } = recorder();
    const idle = new SeatIdleRegistry({ idleMs: () => 900_000, inUse: () => true, stop: async () => {} });
    await expect(startSeatLifecycle({ ...SHARED_LOCAL_VM_TARGET, seat: 2 }, idle, { runtime: "docker", runner, sleep: async () => {} }))
      .rejects.toThrow(/seat 2 did not start/);
    expect(idle.alive()).toEqual([]);
  });
});

describe("two bots on the shared desktop", () => {
  it("get separate seats, displays, sockets and turn locks", () => {
    const table = new SeatLeaseTable(() => 2, 60_000);
    const targets = [["bot-a", "t1"], ["bot-b", "t2"]].map(([ownerId, threadId]) => {
      const leased = table.acquire({ ownerId: ownerId!, threadId: threadId! }, 0);
      if (!leased.ok) throw new Error(leased.reason);
      return leased.lease.seat.seat === 1 ? SHARED_LOCAL_VM_TARGET : { ...SHARED_LOCAL_VM_TARGET, seat: leased.lease.seat.seat };
    });
    const [first, second] = targets as [typeof SHARED_LOCAL_VM_TARGET, typeof SHARED_LOCAL_VM_TARGET];
    expect(first.containerName).toBe(second.containerName);
    expect(localVmSeatKey(first)).toBe("shared");
    expect(localVmSeatKey(second)).toBe("shared#seat:2");
    expect(cuaExecArgs(["mcp"], { seat: first.seat })).toContain("DISPLAY=:1");
    expect(cuaExecArgs(["mcp"], { seat: second.seat })).toContain("DISPLAY=:2");
    expect(containerComputerMcp("docker", undefined, first, first.seat).args[3]).toBe("/run/user/1000/openmausbot-cua.sock");
    expect(containerComputerMcp("docker", undefined, second, second.seat).args[3]).toBe("/run/user/1000/openmausbot-cua-2.sock");
    expect(table.acquire({ ownerId: "bot-c", threadId: "t3" }, 0)).toEqual({ ok: false, reason: "no-free-seat" });
    expect(table.acquire({ ownerId: "bot-a", threadId: "t1" }, 0)).toMatchObject({ ok: true, lease: { seat: { seat: 1 } } });
  });
});

describe("view-only viewer password", () => {
  it("gives every new container its own view-only password, separate from the full one", () => {
    const env = (args: string[], name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    const first = containerRunArgs("docker", "full-pass");
    const second = containerRunArgs("docker", "full-pass");
    expect(env(first, "VNC_PW")).toBe("full-pass");
    expect(env(first, "VNC_VIEW_PW")).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(env(first, "VNC_VIEW_PW")).not.toBe(env(second, "VNC_VIEW_PW"));
  });

  it("hands x11vnc the view-only password after the full one", () => {
    const dockerfile = managedImageDockerfile();
    const full = dockerfile.indexOf('printenv VNC_PW > "$home/.vnc/passwd-$seat"');
    const view = dockerfile.indexOf("{ echo __BEGIN_VIEWONLY__; printenv VNC_VIEW_PW; } >>");
    expect(full).toBeGreaterThan(-1);
    expect(view).toBeGreaterThan(full);
    expect(dockerfile.indexOf("-passwdfile", view)).toBeGreaterThan(view);
  });

  it("takes the VNC home from the passwd entry and refuses to serve a seat without a password", () => {
    const dockerfile = managedImageDockerfile();
    const vnc = dockerfile.slice(dockerfile.indexOf("'  vnc)'"), dockerfile.indexOf("'  viewer)'"));
    expect(vnc).toContain('home="$(getent passwd "$(id -u)" | cut -d: -f6)"');
    expect(vnc).not.toContain("$HOME");
    const refusal = vnc.indexOf('if [ -z "$(printenv VNC_PW || true)" ]; then echo');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(vnc.indexOf("-passwdfile"));
    expect(vnc.slice(refusal, vnc.indexOf("\n", refusal))).toContain("exit 1");
  });
});
