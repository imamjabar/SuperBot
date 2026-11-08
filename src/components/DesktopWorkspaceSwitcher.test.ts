import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { DesktopWorkspaceSwitcher, openServerMenu } from "./DesktopWorkspaceSwitcher";

afterEach(() => { vi.unstubAllGlobals(); });

it("names the saved-server switcher with the product word, not workspace", () => {
  vi.stubGlobal("window", { ogb: { workspaces: { state: () => new Promise(() => {}), menu: () => Promise.resolve() } } });
  const html = renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher));
  expect(html).toContain('aria-label="Switch server: Servers"');
  expect(html).toContain(">Servers<");
  expect(html).not.toMatch(/workspace/i);
});

it("renders nothing outside the desktop app", () => {
  vi.stubGlobal("window", {});
  expect(renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher))).toBe("");
});


it("is the Show me how tip's anchor, and opens the menu as reached from the tip only while the tip is up", async () => {
  vi.stubGlobal("window", { ogb: { workspaces: { state: () => new Promise(() => {}), menu: () => Promise.resolve() } } });
  for (const props of [{}, { inline: true }, { compact: true }]) expect(renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher, props))).toContain('data-tour="server-switcher"');
  const menu = vi.fn(() => Promise.resolve()), onClosed = vi.fn();
  await openServerMenu({ menu }, { howTo: true, onClosed });
  expect(menu).toHaveBeenLastCalledWith({ from: "howto" }); expect(onClosed).toHaveBeenCalledOnce();
  menu.mockRejectedValueOnce(new Error("no menu"));
  await expect(openServerMenu({ menu }, { howTo: true, onClosed })).rejects.toThrow("no menu");
  expect(onClosed).toHaveBeenCalledTimes(2);
  await openServerMenu({ menu }, { onClosed });
  expect(menu).toHaveBeenLastCalledWith(undefined); expect(onClosed).toHaveBeenCalledTimes(2);
});

it("draws Simple mode's switcher as a rounded pill that names the server in full, swapping to the laptop icon only when the row is too narrow", () => {
  vi.stubGlobal("window", { ogb: { workspaces: { state: () => new Promise(() => {}), menu: () => Promise.resolve() } } });
  const pill = renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher, { inline: true, pill: true }));
  expect(pill).toMatch(/aria-label="Switch server: Servers" aria-haspopup="menu" aria-expanded="false"[^>]*class="[^"]*\bh-8\b[^"]*\brounded-full\b[^"]*\bbg-raised\/50\b[^"]*\btext-\[13px\][^"]*\bfont-medium\b/);
  expect(pill).toContain('<span class="min-w-0 truncate @max-[124px]/sidebar-top:hidden">Servers</span>');
  expect(pill).toContain("lucide-chevron-down");
  expect(pill).toContain('class="lucide lucide-laptop hidden shrink-0 text-ink-secondary @max-[124px]/sidebar-top:block"');
  expect(pill).not.toContain("@max-[96px]");
  const inline = renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher, { inline: true }));
  expect(inline).toContain("lucide-laptop");
  expect(inline).toMatch(/class="[^"]*\bh-7\b[^"]*\brounded-md\b[^"]*\btext-\[13px\]/);
  expect(inline).not.toContain("rounded-full");


});
