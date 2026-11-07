import { describe, expect, it } from "vitest";
import { setLocale, t } from "./i18n";
import { jobNowPhrases } from "./job-status";
import { turnNowPhrases } from "./live-activity";
import type { TurnLive } from "@/state/turn-status";

setLocale("en");

describe("jobNowPhrases", () => {
  it("shows Starting when no turn has been seen yet", () => {
    const live: TurnLive = { ended: false, status: null };
    const phrases = jobNowPhrases(live);
    expect(phrases.phrases).toEqual([t("chat.job.starting")]);
    expect(phrases.phase).toBe("job:starting");
  });

  it("shows Waiting for computer when a wait marker is present", () => {
    const live: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: null,
      waiting: { resource: "computer:box:bx_1" },
    };
    const phrases = jobNowPhrases(live);
    expect(phrases.phrases).toEqual([t("chat.job.waitingComputer")]);
    expect(phrases.phase).toBe("job:waitingComputer");
  });

  it("shows Writing the answer when the status is reply", () => {
    const live: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "reply" },
    };
    const phrases = jobNowPhrases(live);
    expect(phrases.phrases).toEqual([t("chat.job.writingAnswer")]);
    expect(phrases.phase).toBe("job:writingAnswer");
  });

  it("shows Waiting for target when a step is quiet with network or idle", () => {
    const networkLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "command", target: "api.kompas.com", quiet: { kind: "network" } },
    };
    expect(jobNowPhrases(networkLive).phrases).toEqual([t("chat.job.waitingFor", { target: "api.kompas.com" })]);

    const idleLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "read", file: "data.json", quiet: { kind: "idle" } },
    };
    expect(jobNowPhrases(idleLive).phrases).toEqual([t("chat.job.waitingFor", { target: "data.json" })]);
  });

  it("reuses turnNowPhrases for a named step with target or file", () => {
    const readLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "read", file: "kompas.com" },
    };
    expect(jobNowPhrases(readLive)).toEqual(turnNowPhrases(readLive.status));

    const webLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "web", target: "vps hosting" },
    };
    expect(jobNowPhrases(webLive)).toEqual(turnNowPhrases(webLive.status));

    const cmdLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "command", target: "scrape.py" },
    };
    expect(jobNowPhrases(cmdLive)).toEqual(turnNowPhrases(cmdLive.status));
  });

  it("handles tool activity via toolService when known, else waits for the stripped tool name", () => {
    const serviceLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "tool", tool: "mcp__linear__create_issue" },
    };
    expect(jobNowPhrases(serviceLive).phrases).toEqual([t("chat.friendly.service", { service: "Linear" })]);

    const unmappedMcpLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "tool", tool: "mcp__server__deploy_cluster" },
    };
    expect(jobNowPhrases(unmappedMcpLive).phrases).toEqual([t("chat.job.waitingFor", { target: "deploy_cluster" })]);

    const bareToolLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "tool", tool: "custom_analyzer" },
    };
    expect(jobNowPhrases(bareToolLive).phrases).toEqual([t("chat.job.waitingFor", { target: "custom_analyzer" })]);
  });

  it("shows Reviewing target when thinking or null status has a lastStep", () => {
    const nullWithLast: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: null,
      lastStep: { activity: "command", target: "scrape.py" },
    };
    expect(jobNowPhrases(nullWithLast).phrases).toEqual([t("chat.job.reviewing", { target: "scrape.py" })]);

    const thinkingWithLast: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "thinking" },
      lastStep: { activity: "write", file: "report.pdf" },
    };
    expect(jobNowPhrases(thinkingWithLast).phrases).toEqual([t("chat.job.reviewing", { target: "report.pdf" })]);
  });

  it("shows Planning the steps when thinking or null with no step seen yet", () => {
    const nullLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: null,
    };
    expect(jobNowPhrases(nullLive).phrases).toEqual([t("chat.job.planning")]);

    const thinkingLive: TurnLive = {
      turnId: "turn-1",
      ended: false,
      status: { activity: "thinking" },
    };
    expect(jobNowPhrases(thinkingLive).phrases).toEqual([t("chat.job.planning")]);
  });
});
