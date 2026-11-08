// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RailPlace, RailState } from "../../electron/rail-places.mjs";
import { setLocale } from "@/lib/i18n";
import { placeInitials, refreshPlaces } from "@/lib/places";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const { PlacesRail, matchingPlaces, placeLabel, shownPlaces } = await import("./PlacesRail");
const { DesktopWorkspaceSwitcher } = await import("./DesktopWorkspaceSwitcher");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const place = (id: string, name: string, extra: Partial<RailPlace> = {}): RailPlace => ({ id, name, color: null, kind: "server", opens: true, ...extra });
const PLACES: RailPlace[] = [
  place("home", "My Cloud", { color: "purple", active: true }),
  place("a", "Client A", { color: "teal" }),
  place("acme", "Acme", { attention: true }),
  place("pending:c-b", "Client B", { opens: false }),
  place("c", "Client C"),
  place("vps", "Office", { kind: "server" }),
];
let host: HTMLDivElement, root: Root | null = null;
let rail: RailState;
const workspaces = { state: vi.fn(async () => ({ local: false, name: "My Cloud" })), menu: vi.fn(async () => {}), places: vi.fn(async () => rail),
  open: vi.fn(async () => {}), add: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined), onChanged: vi.fn(() => () => {}) };
async function mount(element: ReturnType<typeof createElement>) {
  root = createRoot(host);
  await act(async () => { await refreshPlaces(); root!.render(element); });
  await act(async () => { await Promise.resolve(); });
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => { (element as HTMLElement).click(); await Promise.resolve(); }); };
beforeEach(() => {
  setLocale("en");
  rail = { places: PLACES, add: { cloud: true, link: true, address: false } };
  Object.assign(window, { ogb: { workspaces } });
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); document.body.innerHTML = ""; });

it("a circle per place, with its initials on its colour; the place on screen is marked, one that needs the person has a dot, one being set up a ring", async () => {
  await mount(createElement(PlacesRail));
  const circles = [...host.querySelectorAll("[data-rail-place]")];
  expect(circles.map((circle) => circle.textContent)).toEqual(["MC", "CA", "A", "CB", "CC", "O"]);
  expect(host.querySelector('[data-rail-place="home"]')?.getAttribute("aria-current")).toBe("page");
  expect(host.querySelector('[data-rail-place="home"] span[style]')?.getAttribute("style")).toContain("var(--identity-purple)");
  expect(host.querySelector('[data-rail-place="acme"] [data-rail-dot]')).toBeTruthy();
  expect(host.querySelector("[data-rail-more-button]")).toBeNull();
  expect(host.querySelector("[data-rail-add]")?.getAttribute("aria-label")).toBe("Add a Cloud or your own server");
});

it("marks the place on screen with a pill on the rail's edge, a short one on hover for a place that opens, and no ring round a tile", async () => {
  await mount(createElement(PlacesRail, { chrome: true }));
  const pill = (id: string) => host.querySelector(`[data-rail-place="${id}"] [data-rail-pill]`);
  expect(pill("home")?.getAttribute("data-rail-pill")).toBe("page");
  expect(pill("home")?.getAttribute("class")).toEqual(expect.stringContaining("h-4"));
  expect(pill("home")?.getAttribute("class"), "on the rail's left edge, outside the tile").toEqual(expect.stringContaining("-left-1.5"));
  expect(pill("a")?.getAttribute("data-rail-pill")).toBe("hover");
  expect(pill("a")?.getAttribute("class")).toEqual(expect.stringContaining("group-hover/tile:opacity-100"));
  expect(pill("pending:c-b"), "nothing to open yet: no pill").toBeNull();
  for (const tile of host.querySelectorAll("[data-rail-place]")) expect(tile.className, tile.getAttribute("data-rail-place")!).not.toMatch(/\bring-/);
  expect(host.querySelector("[data-places-rail] ul")?.className, "as wide as the rail, so a list that scrolls cuts nothing off round a tile").toEqual(expect.stringContaining("w-full"));
});

it("a click opens the place through main by its id; the one on screen and one not ready yet open nothing", async () => {
  await mount(createElement(PlacesRail));
  await click(host.querySelector('[data-rail-place="a"]'));
  await click(host.querySelector('[data-rail-place="home"]'));
  await click(host.querySelector('[data-rail-place="pending:c-b"]'));
  expect(workspaces.open.mock.calls).toEqual([["a"]]);
});

it("one place or none, an older app, or a browser: no rail, and the switcher stays", async () => {
  rail = { places: [], add: { cloud: true, link: true, address: true } };
  await mount(createElement("div", null, createElement(PlacesRail), createElement(DesktopWorkspaceSwitcher, { inline: true })));
  expect(host.querySelector("[data-places-rail]")).toBeNull();
  expect(host.querySelector("[data-switcher-beside-rail]")).toBeNull();
  expect(host.querySelector('[data-workspace-switcher="inline"]')).toBeTruthy();
});

it("beside the rail, the switcher at the top of the sidebar steps aside on a wide window", async () => {
  await mount(createElement("div", null, createElement(PlacesRail), createElement(DesktopWorkspaceSwitcher, { inline: true })));
  expect(host.querySelector("[data-places-rail]")?.className).toContain("md:flex");
  expect(host.querySelector("[data-switcher-beside-rail]")?.className).toContain("md:hidden");
});

it("past eight places, ⋯ opens every place, searchable; the place on screen stays among the circles", async () => {
  const many = Array.from({ length: 11 }, (_, n) => place(`p${n}`, `Client ${String.fromCharCode(65 + n)}`, n === 9 ? { active: true } : {}));
  rail = { places: many, add: { cloud: true, link: true, address: false } };
  expect(shownPlaces(many).map((entry) => entry.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p9"]);
  expect(shownPlaces(PLACES)).toEqual(PLACES);
  await mount(createElement(PlacesRail));
  expect(host.querySelectorAll("[data-rail-place]")).toHaveLength(8);
  await click(host.querySelector("[data-rail-more-button]"));
  const list = host.querySelector("[data-rail-more]")!;
  expect(list.querySelectorAll("li")).toHaveLength(11);
  const input = list.querySelector("input")!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(input, "client k");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect([...list.querySelectorAll("li")].map((row) => row.textContent)).toEqual(["CKClient K"]);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(workspaces.open.mock.calls).toEqual([["p10"]]);
  expect(matchingPlaces(many, "zzz")).toEqual([]);
});

const type = async (input: Element | null, value: string) => {
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async (form: Element | null) => {
  expect(form).toBeTruthy();
  await act(async () => { (form as HTMLFormElement).requestSubmit(); await Promise.resolve(); await Promise.resolve(); });
};

it("＋ offers adding the person's own server: a box to paste its pairing link, sent to main's own Connect dialog", async () => {
  await mount(createElement(PlacesRail));
  await click(host.querySelector("[data-rail-add]"));
  const form = document.querySelector('[data-place-add="own-server"]')!;
  expect(form.textContent).toContain("Paste pairing link");
  expect(form.textContent, "no install commands: the server's Settings shows its link").not.toContain("npx");
  expect(document.activeElement).toBe(form.querySelector("[data-own-server-link]"));
  const connect = [...form.querySelectorAll("button")].find((button) => button.textContent === "Connect")!;
  expect(connect.disabled, "nothing pasted yet").toBe(true);
  await type(form.querySelector("[data-own-server-link]"), "  https://bots.example.test/#pair=abc  ");
  await submit(form);
  expect(workspaces.add.mock.calls).toEqual([["link", "https://bots.example.test/#pair=abc"]]);
  expect(document.querySelector("[data-place-add-sheet]")).toBeNull();
});

it("a pasted link main can't open says so and keeps the sheet; cancelling main's Connect keeps it too", async () => {
  await mount(createElement(PlacesRail));
  await click(host.querySelector("[data-rail-add]"));
  const form = document.querySelector('[data-place-add="own-server"]')!;
  await type(form.querySelector("[data-own-server-link]"), "not a link");
  workspaces.add.mockRejectedValueOnce(new Error("Enter an HTTPS server address or a full pairing link."));
  await submit(form);
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("isn't a pairing link");
  expect(document.querySelector("[data-place-add-sheet]")).toBeTruthy();
  await type(form.querySelector("[data-own-server-link]"), "https://bots.example.test/#pair=abc");
  expect(form.querySelector('[role="alert"]'), "editing the link clears the error").toBeNull();
  workspaces.add.mockResolvedValueOnce(false);
  await submit(form);
  expect(document.querySelector("[data-place-add-sheet]"), "the person cancelled Connect").toBeTruthy();
});


it("a circle's letters and words", () => {
  expect(["Client A", "Acme", "  my  cloud ", "Ünïcode Øne", "😀 Fun"].map(placeInitials)).toEqual(["CA", "A", "MC", "ÜØ", "😀F"]);
  expect(placeLabel(place("local", "This computer", { kind: "computer" }))).toBe("This computer");
  expect(placeLabel(place("x", "Acme", { attention: true }))).toBe("Acme: needs you");
});


it("the window's own rail: drawn at every width, 36px wide with small rounded tiles named on hover, and its sheets cover the window while open", async () => {
  const expand = vi.fn(async () => {});
  Object.assign(window, { ogb: { workspaces, rail: { expand, onSkin: () => () => {} } } });
  await mount(createElement(PlacesRail, { chrome: true }));
  const nav = host.querySelector("[data-places-rail]")!;
  expect(nav.className).toContain("flex h-full");
  expect(nav.className.split(" "), "as thin as its tiles allow; beside a window with its own title bar, in the sidebar's colour as before the frame")
    .toEqual(expect.arrayContaining(["w-9", "shrink-0", "flex-col", "items-center", "bg-panel"]));
  expect(nav.className, "never hidden on a narrow window").not.toContain("hidden");
  expect(nav.textContent, "no name under the place on screen: its tile's ring marks it").toBe("MCCAACBCCO");
  expect(host.querySelector('[data-rail-place="home"]')?.getAttribute("title")).toBe("My Cloud");
  expect(host.querySelector('[data-rail-place="home"] span[style]')?.getAttribute("style")).toContain("width: 24px; height: 24px; border-radius: 7px");
  expect(host.querySelector("[data-rail-add]")?.className).toContain("size-6 place-items-center rounded-[7px]");
  expect(expand.mock.calls.at(-1)).toEqual([false]);
  await click(host.querySelector("[data-rail-add]"));
  expect(expand.mock.calls.at(-1), "＋'s sheet covers the window").toEqual([true]);
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
  expect(expand.mock.calls.at(-1), "and gives it back once closed").toEqual([false]);
});

it("beside the window's own rail (main says so; the page never reads the list), the sidebar's switcher and Switch to… step aside at every width", async () => {
  rail = { places: [], add: { cloud: false, link: false, address: false }, beside: true };
  await mount(createElement("div", null, createElement(PlacesRail), createElement(DesktopWorkspaceSwitcher, { inline: true })));
  expect(host.querySelector("[data-places-rail]"), "no rail drawn on the page itself").toBeNull();
  expect(host.querySelector("[data-switcher-beside-rail]")?.className).toBe("hidden");
  const { placeMenuItems } = await import("./SidebarProfileMenu");
  const place = { bridge: workspaces, current: { local: false, name: "Office" }, onLine: "", openMenu: () => {}, switchable: true } as never;
  expect(placeMenuItems(place).map((item) => item.key)).toEqual(["place", "switch-place"]);
  expect(placeMenuItems(place, { besideRail: true }).map((item) => item.key), "one switcher: the rail").toEqual(["place"]);
});

it("a right-click on a circle opens its place's menu: its colour, saved by main whatever its server runs, This computer's too; a member sees who may change it", async () => {
  const expand = vi.fn(async () => {});
  const recolor = vi.fn(async () => ({ outcome: "saved" as const, look: null }));
  rail = { places: [
    place("local", "This computer", { kind: "computer", active: true, color: "teal", paint: { swatch: "green" } }),
    place("vps", "Office", { kind: "server", paint: { swatch: null } }),
    place("acme", "Acme", { kind: "computer", color: "purple", paint: { swatch: "violet", locked: "member" } }),
  ], add: { cloud: false, link: true, address: false } };
  Object.assign(window, { ogb: { workspaces: { ...workspaces, recolor }, rail: { expand, onSkin: () => () => {} } } });
  await mount(createElement(PlacesRail, { chrome: true }));
  const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  const menuOf = async (id: string) => {
    await act(async () => { host.querySelector(`[data-rail-place="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    return host.querySelector(`[data-rail-menu="${id}"]`);
  };
  expect(host.querySelector('[data-rail-place="local"] span[style]')?.getAttribute("style"), "This computer's circle wears its colour").toContain("var(--identity-teal)");
  const own = await menuOf("local");
  expect([own?.getAttribute("aria-label"), own?.querySelector("[aria-checked='true']")?.getAttribute("data-swatch")]).toEqual(["This computer", "green"]);
  expect(own!.querySelector("[data-swatch='slate']")?.getAttribute("aria-label"), "the plain swatch says what it does").toBe("None");
  await click(own!.querySelector("[data-swatch='slate']"));
  await settle();
  expect(recolor).toHaveBeenCalledWith("local", "slate");
  expect([host.querySelector("[data-rail-menu]"), expand.mock.calls.at(-1)]).toEqual([null, [false]]);
  const menu = await menuOf("vps");
  expect(menu?.getAttribute("aria-label")).toBe("Office");
  expect(expand.mock.calls.at(-1), "the menu covers the window while open").toEqual([true]);
  await click(menu!.querySelector("[data-swatch='green']"));
  await settle();
  expect(recolor).toHaveBeenCalledWith("vps", "green");
  expect(host.querySelector("[data-rail-menu]"), "saved: the menu closes, and the circle follows main's list").toBeNull();
  expect(expand.mock.calls.at(-1)).toEqual([false]);
  const locked = await menuOf("acme");
  expect(locked?.querySelector("[data-rail-menu-note]")?.textContent).toBe("Only its admins can change its color.");
  expect([...locked!.querySelectorAll<HTMLButtonElement>("[data-swatch]")].every((swatch) => swatch.disabled), "a member sees it, and can't change it").toBe(true);
  expect(locked!.querySelector("[aria-checked='true']")?.getAttribute("data-swatch")).toBe("violet");
  await act(async () => { locked!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(host.querySelector("[data-rail-menu]")).toBeNull();
});

