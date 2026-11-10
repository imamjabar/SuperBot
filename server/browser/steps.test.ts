import { describe, expect, it, vi } from "vitest";

import { REFS_GONE } from "../browser-tool-shape.ts";
import { MAX_STEPS, NewElementMarks, runSteps, STEPS_BUDGET_MS, STEPS_TOOL } from "./steps.ts";

const text = (value: string, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: "text", text: value }] });
const SNAPSHOT = '- textbox "Email" [ref=e1]\n- button "Send" [ref=e2]';

function engine(answers: Record<string, ReturnType<typeof text>> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return answers[name] ?? text(name === "agent_browser_snapshot" ? SNAPSHOT : `${name} ok.`);
  });
  return { call, calls };
}

describe("a list of browser steps", () => {
  it("runs each step as its own call in order, then answers with the page's snapshot", async () => {
    const { call, calls } = engine();
    const result = await runSteps({ arguments: { steps: [{ tool: "fill", arguments: { ref: "e1", text: "a@b.c" } }, { tool: "agent_browser_click", arguments: { ref: "e2" } }] } }, call);
    expect(calls).toEqual([
      { name: "agent_browser_fill", args: { ref: "e1", text: "a@b.c" } },
      { name: "agent_browser_click", args: { ref: "e2" } },
      { name: "agent_browser_snapshot", args: {} },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.content.map((part) => part.text)).toEqual(["1. fill: agent_browser_fill ok.\n2. click: agent_browser_click ok.\nThe page after the steps:", SNAPSHOT]);
  });

  it("stops at the first failing step and reports it as an error without a snapshot", async () => {
    const { call, calls } = engine({ agent_browser_click: text("The element e2 is no longer on the page.", true) });
    const result = await runSteps({ arguments: { steps: [{ tool: "click", arguments: { ref: "e2" } }, { tool: "press", arguments: { key: "Enter" } }, { tool: "click", arguments: { ref: "e3" } }] } }, call);
    expect(calls.map((entry) => entry.name)).toEqual(["agent_browser_click"]);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Step 1 failed, so steps 2 to 3 did not run.");
  });

  it("stops before a ref from the old page once a step moved to another page, but runs steps that need no ref", async () => {
    const moved = engine({ agent_browser_click: text(`Clicked e2. The page is now https://x.test/next. ${REFS_GONE}`) });
    await runSteps({ arguments: { steps: [{ tool: "click", arguments: { ref: "e2" } }, { tool: "fill", arguments: { ref: "e7", text: "x" } }] } }, moved.call);
    expect(moved.calls.map((entry) => entry.name)).toEqual(["agent_browser_click", "agent_browser_snapshot"]);

    const waits = engine({ agent_browser_click: text(`Clicked e2. The page is now https://x.test/next. ${REFS_GONE}`) });
    await runSteps({ arguments: { steps: [{ tool: "click", arguments: { ref: "e2" } }, { tool: "wait", arguments: { text: "Welcome" } }] } }, waits.call);
    expect(waits.calls.map((entry) => entry.name)).toEqual(["agent_browser_click", "agent_browser_wait", "agent_browser_snapshot"]);
  });

  it("refuses a list it must not run before reaching the browser", async () => {
    for (const args of [
      { steps: [] },
      { steps: Array.from({ length: MAX_STEPS + 1 }, () => ({ tool: "press", arguments: { key: "Tab" } })) },
      { steps: [{ tool: "press", arguments: { key: "Tab" } }, { tool: "open", arguments: { url: "https://x.test" } }] },
      { steps: [{ tool: "eval", arguments: { expression: "1" } }] },
      { steps: [{ tool: STEPS_TOOL, arguments: {} }] },
      { steps: [{ tool: "click", arguments: "e2" }] },
    ]) {
      const { call } = engine();
      const result = await runSteps({ arguments: args }, call);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("starts no step once the list's time is spent", async () => {
    let clock = 0;
    const { call, calls } = engine();
    call.mockImplementation(async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); clock += STEPS_BUDGET_MS; return text("ok."); });
    const result = await runSteps({ arguments: { steps: [{ tool: "press", arguments: { key: "Tab" } }, { tool: "press", arguments: { key: "Tab" } }], snapshot: false } }, call, () => clock);
    expect(calls).toHaveLength(1);
    expect(result.content[0]?.text).toContain("Steps 2 to 2 did not run: the list ran out of time.");
  });
});

describe("new-element marks", () => {
  const snapshotOf = (marks: NewElementMarks, tree: string, session = "s") => (marks.after(session, "agent_browser_snapshot", text(tree)) as ReturnType<typeof text>).content[0]!.text;

  it("marks what appeared since the previous look at the same page, and only that", () => {
    const marks = new NewElementMarks();
    marks.after("s", "agent_browser_open", text(`Opened https://x.test.\n${SNAPSHOT}\n- link "More" [ref=e3]`));
    const next = snapshotOf(marks, `${SNAPSHOT}\n- link "More" [ref=e3]\n- option "Zurich" [ref=e9]\n- button "Send" [ref=e10]`);
    expect(next.split("\n")).toEqual([
      '- textbox "Email" [ref=e1]',
      '- button "Send" [ref=e2]',
      '- link "More" [ref=e3]',
      '- option "Zurich" [ref=e9] [new]',
      '- button "Send" [ref=e10] [new]',
    ]);
    expect(snapshotOf(marks, `${SNAPSHOT}\n- link "More" [ref=e3]\n- option "Zurich" [ref=e9]\n- button "Send" [ref=e10]`)).not.toContain("[new]");
  });

  it("marks nothing on a first look, on another page, after a navigation, or in another session", () => {
    const marks = new NewElementMarks();
    expect(snapshotOf(marks, SNAPSHOT)).not.toContain("[new]");
    expect(snapshotOf(marks, '- link "Home" [ref=e4]\n- link "Docs" [ref=e5]')).not.toContain("[new]");
    marks.after("s", "agent_browser_navigate", text("now elsewhere"));
    expect(snapshotOf(marks, `${SNAPSHOT}\n- button "Extra" [ref=e7]`)).not.toContain("[new]");
    expect(snapshotOf(marks, `${SNAPSHOT}\n- button "Other" [ref=e8]`, "t")).not.toContain("[new]");
  });
});
