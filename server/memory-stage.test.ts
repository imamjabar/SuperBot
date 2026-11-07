import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { MemoryWriter } from "./memory-stage.ts";
import { memoryLogPath, readMemoryFile, workspaceDir } from "./workspace.ts";

let counter = 0;
const fresh = () => ({ layer: `stage-bot-${process.pid}-${counter}`, threadId: `stage-thread-${counter++}` });
const direct: MemoryWriter = (write) => write();
const opts = { source: 'chat "Plans"', aboutMe: null };
const notes = (layer: string) => readMemoryFile(layer).text;
const log = (layer: string) => {
  const path = join(workspaceDir(layer), memoryLogPath());
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};
const occurrences = (text: string, fact: string) => text.split(fact).length - 1;

/** A fresh copy of the module, as a restarted server process loads it. */
async function restarted() {
  vi.resetModules();
  return import("./memory-stage.ts");
}

async function turn(threadId: string, layer: string, facts: { note: string; logged: string }) {
  const stages = await import("./memory-stage.ts");
  stages.openMemoryStage(threadId);
  const stage = stages.memoryStage(threadId)!;
  expect(stages.stageBotMemoryUpdate(stage, layer, { action: "append", text: facts.note }, opts, direct)).toMatchObject({ ok: true, entry: expect.stringContaining(facts.note) });
  expect(stages.stageMemoryLog(stage, layer, facts.logged, { source: opts.source }, direct)).toMatchObject({ ok: true, line: expect.stringContaining(facts.logged) });
  return stages;
}

describe("staged memory writes", () => {
  it("a successful turn saves what it staged once, and the turn saw its own notes before then", async () => {
    const { layer, threadId } = fresh();
    const stages = await turn(threadId, layer, { note: "Ada prefers figs.", logged: "Sent the invoice." });
    const stage = stages.memoryStage(threadId)!;
    expect(notes(layer)).not.toContain("figs");
    expect(log(layer)).toBe("");
    expect(stages.stageBotMemoryUpdate(stage, layer, { action: "replace", oldText: "Ada prefers figs.", text: "Ada prefers dates." }, opts, direct).ok).toBe(true);
    expect(stages.stageBotMemoryUpdate(stage, layer, { action: "remove", oldText: "no such note" }, opts, direct)).toMatchObject({ ok: false, code: "conflict" });

    expect(stages.settleMemoryStage(threadId, true)).toBe(3);
    expect(stages.settleMemoryStage(threadId, true)).toBe(0);
    expect(occurrences(notes(layer), "Ada prefers dates.")).toBe(1);
    expect(notes(layer)).not.toContain("figs");
    expect(occurrences(log(layer), "Sent the invoice.")).toBe(1);
  });

  it("a turn that fails or is stopped leaves no memory, About me included", async () => {
    const { layer, threadId } = fresh();
    const stages = await turn(threadId, layer, { note: "Ada moved to Pune.", logged: "Booked the flight." });
    const prefer = { person: "Ada", save: vi.fn(() => 1) };
    expect(stages.stageBotMemoryUpdate(stages.memoryStage(threadId)!, layer, { action: "prefer", text: "Short answers" }, { ...opts, prefer }, direct))
      .toEqual({ ok: true, preference: "saved", person: "Ada" });

    expect(stages.settleMemoryStage(threadId, false)).toBe(0);
    expect(notes(layer)).not.toContain("Pune");
    expect(log(layer)).toBe("");
    expect(prefer.save).not.toHaveBeenCalled();
  });

  it("a restart mid-turn drops what the turn staged", async () => {
    const { layer, threadId } = fresh();
    await turn(threadId, layer, { note: "Ada's train leaves at 9.", logged: "Checked the timetable." });

    const after = await restarted();
    expect(after.memoryStage(threadId)).toBeUndefined();
    expect(after.settleMemoryStage(threadId, true)).toBe(0);
    expect(notes(layer)).not.toContain("train");
    expect(log(layer)).toBe("");
  });

  it("a turn run again after a restart that followed its save adds nothing twice", async () => {
    const { layer, threadId } = fresh();
    const facts = { note: "Ada's office is on floor 4.", logged: "Filed the access request." };
    expect((await turn(threadId, layer, facts)).settleMemoryStage(threadId, true)).toBe(2);

    await restarted();
    expect((await turn(threadId, layer, facts)).settleMemoryStage(threadId, true)).toBe(2);
    expect(occurrences(notes(layer), facts.note)).toBe(1);
    expect(occurrences(log(layer), facts.logged)).toBe(1);
  });

  it("forget in the turn drops the staged notes it names, so success cannot bring them back", async () => {
    const { layer, threadId } = fresh();
    const stages = await turn(threadId, layer, { note: "Ada's PIN hint is kumquat.", logged: "Reset the router." });
    const stage = stages.memoryStage(threadId)!;
    expect(stages.stageBotMemoryUpdate(stage, layer, { action: "append", text: "Ada likes tea." }, opts, direct).ok).toBe(true);
    expect(stages.stageBotMemoryUpdate(stage, layer, { action: "forget", oldText: "kumquat" }, opts, direct))
      .toMatchObject({ ok: true, forgotten: ["Ada's PIN hint is kumquat."] });
    expect(stages.stageBotMemoryUpdate(stage, layer, { action: "remove", oldText: "Ada's PIN hint is kumquat." }, opts, direct)).toMatchObject({ ok: false, code: "conflict" });

    stages.settleMemoryStage(threadId, true);
    expect(notes(layer)).not.toContain("kumquat");
    expect(notes(layer)).toContain("Ada likes tea.");
  });
});
