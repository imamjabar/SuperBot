import { describe, expect, it } from "vitest";
import { isOwnJobThread } from "./job-threads";

describe("isOwnJobThread", () => {
  it("recognizes report_back job opened on itself", () => {
    const task = {
      title: "Research competitors",
      openedBy: { botId: "chief", reportsBack: true },
    };
    expect(isOwnJobThread(task, "chief")).toBe(true);
  });

  it("rejects jobs opened on another bot", () => {
    const task = {
      title: "Research competitors",
      openedBy: { botId: "scout", reportsBack: true },
    };
    expect(isOwnJobThread(task, "chief")).toBe(false);
  });

  it("rejects threads without reportsBack flag", () => {
    const task = {
      title: "General chat",
      openedBy: { botId: "chief" },
    };
    expect(isOwnJobThread(task, "chief")).toBe(false);
  });

  it("rejects undefined or null task", () => {
    expect(isOwnJobThread(undefined, "chief")).toBe(false);
    expect(isOwnJobThread(null, "chief")).toBe(false);
  });
});
