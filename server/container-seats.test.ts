import { describe, expect, it } from "vitest";

import { CONTAINER, containerComputerMcp, containerExec, cuaExecArgs, type CommandRunner } from "./container-computer.ts";
import { containerSeatStatus, containerStartSeat, containerStopSeat, parseSeatStatus, seatPrograms } from "./container-seats.ts";

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
    expect(calls[0]!.args[6]).toContain('rm -f "/etc/supervisor/conf.d/seat-$1.conf"');
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

  it("reports a seat running only when every program runs and its socket exists", async () => {
    const programs = seatPrograms(2);
    expect(programs).toEqual(["xvfb-2", "xfce-2", "vncserver-2", "novnc-2", "openmausbot-cua-driver-2"]);
    const running = programs.map((name) => `${name}   RUNNING   pid 1, uptime 0:00:05`).join("\n");
    const { runner, calls } = recorder(`${running}\nopenmausbot-seat-socket-ready\n`);
    const status = await containerSeatStatus(2, { runtime: "docker", runner });
    expect(calls[0]!.args.slice(-6)).toEqual(["/run/user/1000/openmausbot-cua-2.sock", ...programs]);
    expect(status).toMatchObject({ running: true, socketReady: true, viewerUrl: null, seat: { viewerPort: 6902 } });
    expect(parseSeatStatus(2, running).running).toBe(false);
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
