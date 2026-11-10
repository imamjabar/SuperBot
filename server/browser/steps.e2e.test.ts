// A step list and new-element marks on real Chrome, through the runtime router as on a server.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BrowserRuntime } from "../browser-runtime.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import { CHROME_ENGINE, RuntimeRouter, type ChromeEngine } from "./engines.ts";
import { startService, type RealService, type ToolResult } from "./testing/real-service.ts";

const suite = CHROME ? describe : describe.skip;
const FORM = `<!doctype html><meta charset="utf-8"><title>Form</title>
<label>City <input id="city" oninput="document.getElementById('list').innerHTML = this.value ? '<button>Zurich</button><button>Zug</button>' : ''"></label>
<div id="list"></div><label>Name <input id="name"></label>
<button onclick="location.href = '/done?n=' + encodeURIComponent(document.getElementById('name').value)">Send</button>`;

suite("a step list in the bots' browser on real Chrome", () => {
  let fx: FixtureServer;
  let real: RealService;
  let router: RuntimeRouter;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    fx.page("/form", FORM);
    fx.page("/done", `<!doctype html><meta charset="utf-8"><title>Done</title><h1>Thanks</h1>`);
    real = await startService();
    router = new RuntimeRouter({ agentRpc: () => Promise.reject(new Error("agent-browser is not part of this suite")) } as unknown as BrowserRuntime, { service: real.service } as unknown as ChromeEngine);
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await fx?.close();
  });

  it("types and fills in one call, marks the suggestions that appeared, and stops before a ref of the page it left", async () => {
    const spec = { command: CHROME_ENGINE, args: ["bot:steps"], env: {} };
    const call = async (name: string, args: Record<string, unknown> = {}) => real.text(await router.agentRpc("steps", spec, "tools/call", { name, arguments: args }) as ToolResult);
    const ref = (text: string, line: RegExp) => line.exec(text)?.[1] ?? "";
    const opened = await call("agent_browser_open", { url: fx.url("/form") });
    const city = ref(opened, /textbox "City" \[ref=(e\d+)\]/u);
    const name = ref(opened, /textbox "Name" \[ref=(e\d+)\]/u);

    const typed = await call("agent_browser_steps", { steps: [{ tool: "type", arguments: { ref: city, text: "Zu" } }, { tool: "fill", arguments: { ref: name, text: "Ada" } }] });
    expect(typed).toMatch(/button "Zurich" \[ref=e\d+\] \[new\]/u);
    expect(typed).toMatch(/button "Zug" \[ref=e\d+\] \[new\]/u);
    expect(typed).not.toMatch(/button "Send" \[ref=e\d+\] \[new\]/u);

    const sent = await call("agent_browser_steps", { steps: [{ tool: "click", arguments: { ref: ref(typed, /button "Send" \[ref=(e\d+)\]/u) } }, { tool: "click", arguments: { ref: city } }] });
    expect(sent).toContain("steps 2 to 2 did not run: their refs belonged to the page before");
    expect(sent).toContain("Thanks");
    expect(sent).not.toContain("[new]");
  }, hostTimeout(90_000));
});
