// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  config: null as null | Record<string, unknown>,
  servers: [] as Array<Record<string, unknown>>,
  sharedHeaders: {} as Record<string, Record<string, string>>,
  test: { ok: true, tools: [{ name: "a" }, { name: "b" }], total: 12 } as Record<string, unknown>,
}));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config, bots: [] }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async () => {}) }));
vi.mock("@/lib/mcp-servers", () => ({ updateMcpServers: vi.fn() }));

import { McpServersPanel, SWITCH_SETTLE_MS } from "./McpServersPanel";

const ID = "id-7f3a9c2e1b.access";
const SECRET = "secret-9d8e7f6a5b4c3d2e1f";
const GATEWAY = `claude mcp add --transport http my-mcp https://mcp.example.com/route \\
  --header "CF-Access-Client-Id: $CF_ID" \\
  --header "CF-Access-Client-Secret: $CF_SECRET"`;

let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve(); });
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
const click = async (label: string) => { await act(async () => button(label)!.click()); await settle(); };
const type = async (selector: string, value: string) => {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
};
const calls = (method: string, path?: string) => fixture.api.mock.calls
  .filter(([url, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === method && (!path || url === path))
  .map(([url, init]) => ({ url: url as string, body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined }));

beforeEach(async () => {
  vi.clearAllMocks();
  setLocale("en");
  fixture.config = null;
  fixture.servers = [];
  fixture.sharedHeaders = {};
  fixture.test = { ok: true, tools: [{ name: "a" }, { name: "b" }], total: 12 };
  fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method === "GET" && path === "/api/mcp/servers") return { servers: fixture.servers };
    if (method === "POST" && path === "/api/mcp/servers") {
      fixture.sharedHeaders[body.name] = body.headers ?? {};
      fixture.servers = [...fixture.servers, { name: body.name, type: body.type, url: body.url, headerKeys: Object.keys(body.headers ?? {}), enabled: false }];
      return { servers: fixture.servers };
    }
    if (method === "POST" && path.endsWith("/test")) return fixture.test;
    if (method === "PATCH") {
      const name = decodeURIComponent(path.split("/").at(-1)!);
      fixture.servers = fixture.servers.map((server) => server.name === name ? { ...server, enabled: body.enabled } : server);
      return { servers: fixture.servers };
    }
    if (method === "PUT" && path.startsWith("/api/mcp/servers/")) {
      const name = decodeURIComponent(path.split("/").at(-1)!);
      fixture.sharedHeaders[name] = body.headers ?? {};
      fixture.servers = fixture.servers.map((server) => server.name === name ? { ...server, headerKeys: Object.keys(body.headers ?? {}), enabled: body.enabled } : server);
      return { servers: fixture.servers };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(() => McpServersPanel())));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Adding an MCP server from one paste box", () => {
  it("reads a pasted claude mcp add command, asks only for the two variables, then saves, connects and turns it on", async () => {
    await click("Add server");
    expect(host.querySelector("[data-mcp-editor] input")).toBeNull();
    await type("textarea[aria-label='Server link or setup command']", GATEWAY);
    expect(host.textContent).toContain("Ready to add my-mcp (mcp.example.com).");
    expect(host.textContent).toContain("Paste the real value of CF_ID here: the command used a variable from your terminal.");
    expect(host.textContent).toContain("Paste the real value of CF_SECRET here: the command used a variable from your terminal.");
    expect([...host.querySelectorAll("[data-mcp-editor] input")].map((input) => [input.getAttribute("aria-label"), input.getAttribute("type")]))
      .toEqual([["CF-Access-Client-Id", "password"], ["CF-Access-Client-Secret", "password"]]);

    await click("Add");
    expect(host.querySelector("[data-mcp-editor] [role=alert]")?.textContent).toBe("Fill in CF-Access-Client-Id, or remove it.");
    expect(calls("POST", "/api/mcp/servers")).toEqual([]);

    await type("input[aria-label='CF-Access-Client-Id']", ID);
    await type("input[aria-label='CF-Access-Client-Secret']", SECRET);
    await click("Add");

    expect(calls("POST", "/api/mcp/servers")).toEqual([{ url: "/api/mcp/servers", body: {
      name: "my-mcp", type: "http", url: "https://mcp.example.com/route", headers: { "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": SECRET },
    } }]);
    expect(calls("POST", "/api/mcp/servers/my-mcp/test")).toHaveLength(1);
    expect(calls("PATCH", "/api/mcp/servers/my-mcp")).toEqual([{ url: "/api/mcp/servers/my-mcp", body: { enabled: true } }]);
    expect(host.querySelector("[data-mcp-editor]")).toBeNull();
    expect(host.textContent).toContain("Connected: 12 tools");
    expect(host.querySelector('[role="switch"][aria-label="Turn my-mcp off"]')?.getAttribute("aria-checked")).toBe("true");
    expect(host.innerHTML).not.toContain(SECRET);
    expect(calls("PUT")).toEqual([]);
  });

  it("says a saved server it can't reach is saved but off, and why, and turns it on from Try again", async () => {
    fixture.test = { ok: false, error: "Could not reach this address. Check the URL and your network.", reason: "unreachable" };
    await click("Add server");
    await type("textarea[aria-label='Server link or setup command']", "https://mcp.acme.example/mcp");
    await click("Add");
    expect(calls("POST", "/api/mcp/servers")[0]?.body).toEqual({ name: "acme", type: "http", url: "https://mcp.acme.example/mcp", headers: {} });
    expect(calls("PATCH")).toEqual([]);
    expect(host.textContent).toContain("Saved, but off: the test failed. Could not reach this address. Check the URL and your network. Your bots can use it once it's on.");
    expect(host.querySelector('[role="switch"][aria-label="Turn acme on"]')?.getAttribute("aria-checked")).toBe("false");
    expect(button("Fix the keys")).toBeUndefined();

    fixture.test = { ok: true, tools: [{ name: "search" }] };
    await click("Try again");
    expect(calls("PATCH", "/api/mcp/servers/acme")).toEqual([{ url: "/api/mcp/servers/acme", body: { enabled: true } }]);
    expect(host.textContent).toContain("Connected: 1 tool");
  });

  it("says which keys a gateway refused, by name only, and Fix the keys asks for just those values and tests again", async () => {
    fixture.test = { ok: false, error: "The server didn't accept the keys (HTTP 403). Check the header values.", reason: "keys", status: 403 };
    await click("Add server");
    await type("textarea[aria-label='Server link or setup command']", GATEWAY);
    await type("input[aria-label='CF-Access-Client-Id']", ID);
    await type("input[aria-label='CF-Access-Client-Secret']", "wrong-secret-value");
    await click("Add");
    expect(host.textContent).toContain(
      "Saved, but off: the test failed. The server didn't accept the keys (HTTP 403). Check the values of CF-Access-Client-Id and CF-Access-Client-Secret. Your bots can use it once it's on.");
    expect(button("Try again")).toBeUndefined();
    expect(host.innerHTML).not.toContain("wrong-secret-value");
    expect(host.innerHTML).not.toContain(ID);

    await click("Fix the keys");
    const editor = host.querySelector("[data-mcp-editor]")!;
    expect(editor.textContent).toContain("Fix the keys for my-mcp");
    expect([...editor.querySelectorAll("input")].map((input) => [input.getAttribute("aria-label"), input.type, input.value, input.placeholder])).toEqual([
      ["CF-Access-Client-Id", "password", "", "Paste the new value"],
      ["CF-Access-Client-Secret", "password", "", "Paste the new value"],
    ]);
    expect(editor.querySelector("textarea")).toBeNull();

    fixture.test = { ok: true, tools: [{ name: "a" }], total: 12 };
    const previous = fixture.api.getMockImplementation()!;
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => init?.method === "PUT" ? { servers: fixture.servers } : previous(path, init));
    await type("input[aria-label='CF-Access-Client-Secret']", SECRET);
    await click("Save");
    expect(calls("PUT", "/api/mcp/servers/my-mcp")[0]?.body).toEqual({
      type: "http", url: "https://mcp.example.com/route", headers: { "CF-Access-Client-Id": true, "CF-Access-Client-Secret": SECRET }, enabled: false,
    });
    expect(calls("POST", "/api/mcp/servers/my-mcp/test")).toHaveLength(2);
    expect(calls("PATCH", "/api/mcp/servers/my-mcp")).toEqual([{ url: "/api/mcp/servers/my-mcp", body: { enabled: true } }]);
    expect(host.textContent).toContain("Connected: 12 tools");
  });

  it("offers a key row to a server that refused without one, and no button for an error a retry can't fix", async () => {
    fixture.test = { ok: false, error: "The server didn't accept the keys (HTTP 401). Check the header values.", reason: "keys", status: 401 };
    await click("Add server");
    await type("textarea[aria-label='Server link or setup command']", "https://mcp.acme.example/mcp");
    await click("Add");
    expect(host.textContent).toContain("The server didn't let it in (HTTP 401). It probably needs a key: add it with Fix the keys.");
    await click("Fix the keys");
    expect([...host.querySelectorAll("[data-mcp-editor] input")].map((input) => input.getAttribute("aria-label"))).toEqual(["Header name", "Value"]);
    await click("Cancel");

    fixture.test = { ok: false, error: "The server did not return a valid MCP tools list." };
    await click("Test");
    expect(host.textContent).toContain("Couldn't connect, so it stays off. The server did not return a valid MCP tools list.");
    expect(button("Try again")).toBeUndefined();
    expect(button("Fix the keys")).toBeUndefined();
  });

  it("says plainly when the paste isn't a server, and keeps Add off", async () => {
    await click("Add server");
    await type("textarea[aria-label='Server link or setup command']", "please help me connect my server");
    expect(host.querySelector("[data-mcp-editor] [role=alert]")?.textContent).toBe(
      "That doesn't look like a server link or a setup command. Check you copied all of it, or fill it in yourself under Edit details.");
    expect(button("Add")?.disabled).toBe(true);
  });

  it("opens a saved server with its header names and no values, and keeps the saved ones on Save", async () => {
    fixture.servers = [{ name: "gate", type: "http", url: "https://mcp.example.com/route", headerKeys: ["CF-Access-Client-Id", "CF-Access-Client-Secret"], enabled: false }];
    fixture.api.mockImplementationOnce(async () => ({ servers: fixture.servers }));
    await act(async () => button("Add server")!.parentElement!.querySelector<HTMLButtonElement>("[aria-label='Refresh MCP servers']")!.click());
    await settle();
    const previous = fixture.api.getMockImplementation()!;
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => init?.method === "PUT" ? { servers: fixture.servers } : previous(path, init));
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Edit gate']")!.click());
    await settle();
    const values = [...host.querySelectorAll<HTMLInputElement>("[data-mcp-editor] input[type=password]")];
    expect(values.map((input) => [input.getAttribute("aria-label"), input.value, input.placeholder])).toEqual([
      ["CF-Access-Client-Id", "", "Saved · leave blank to keep it"],
      ["CF-Access-Client-Secret", "", "Saved · leave blank to keep it"],
      [null, "", "Optional, for a confidential app"],
    ]);
    await type("input[aria-label='CF-Access-Client-Secret']", "rotated-secret");
    await click("Save");
    expect(calls("PUT", "/api/mcp/servers/gate")[0]?.body).toEqual({
      type: "http", url: "https://mcp.example.com/route", headers: { "CF-Access-Client-Id": true, "CF-Access-Client-Secret": "rotated-secret" }, enabled: false,
    });
    expect(calls("PATCH", "/api/mcp/servers/gate")).toEqual([{ url: "/api/mcp/servers/gate", body: { enabled: true } }]);
  });
});

describe("A saved server's switch", () => {
  it("says it's off until it passes a test while that test runs", async () => {
    let answer: (result: Record<string, unknown>) => void = () => {};
    const previous = fixture.api.getMockImplementation()!;
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => init?.method === "POST" && path.endsWith("/test")
      ? new Promise((resolve) => { answer = resolve; }) : previous(path, init));
    await click("Add server");
    await type("textarea[aria-label='Server link or setup command']", "https://mcp.acme.example/mcp");
    await click("Add");
    expect(host.querySelector("[data-mcp-testing]")?.textContent?.trim()).toBe("Off until it passes a test: testing it now.");
    await act(async () => answer({ ok: true, tools: [{ name: "search" }] }));
    await settle();
    expect(host.querySelector("[data-mcp-testing]")).toBeNull();
    expect(host.textContent).toContain("Connected: 1 tool");
  });

  it("keeps a server a passing test just switched on, on, when a click lands right after", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      await click("Add server");
      await type("textarea[aria-label='Server link or setup command']", "https://mcp.acme.example/mcp");
      await click("Add");
      expect(calls("PATCH", "/api/mcp/servers/acme")).toEqual([{ url: "/api/mcp/servers/acme", body: { enabled: true } }]);
      // The person reached for the Off they saw: the click lands a moment after the test switched it on.
      now.mockReturnValue(1_000_900);
      await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Turn acme off"]')!.click());
      await settle();
      expect(calls("PATCH", "/api/mcp/servers/acme"), "never switched straight back off").toHaveLength(1);
      expect(host.querySelector('[role="switch"][aria-label="Turn acme off"]')?.getAttribute("aria-checked")).toBe("true");
      expect(host.textContent).toContain("acme is on: it passed its test a moment ago.");
      // Later, the same click switches it off.
      now.mockReturnValue(1_000_000 + SWITCH_SETTLE_MS + 1);
      await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Turn acme off"]')!.click());
      await settle();
      expect(calls("PATCH", "/api/mcp/servers/acme").at(-1)).toEqual({ url: "/api/mcp/servers/acme", body: { enabled: false } });
      expect(host.querySelector('[role="switch"][aria-label="Turn acme on"]')?.getAttribute("aria-checked")).toBe("false");
    } finally {
      now.mockRestore();
    }
  });
});
