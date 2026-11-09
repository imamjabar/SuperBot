import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { ChiefHero } from "./SidebarChiefHero";

const chief: Bot = {
  id: "atlas",
  name: "Atlas",
  title: "Chief of Staff",
  description: "",
  threadId: "atlas-thread",
  chiefOfStaff: true,
  color: "blue",
  unread: false,
  busy: false,
  tasks: [],
  projects: [],
  messages: [],
} as unknown as Bot;

describe("ChiefHero", () => {
  it("renders the chief avatar, name and chief of staff label", () => {
    const html = renderToStaticMarkup(createElement(ChiefHero, {
      bot: chief,
      selected: false,
      onOpen: vi.fn(),
      onMenu: vi.fn(),
    }));

    expect(html).toContain('data-sidebar-hero="atlas"');
    expect(html).toContain("Atlas");
    expect(html).toContain("Chief of Staff");
    expect(html).toContain("lucide-crown");
    expect(html).not.toContain('data-testid="working-dot"');
    expect(html).not.toContain('data-testid="unread-dot"');
  });
  it("shows working dot when chief is busy or working", () => {
    const html = renderToStaticMarkup(createElement(ChiefHero, {
      bot: { ...chief, busy: true, tasks: [{ threadId: "atlas-thread", busy: true, createdAt: 1, title: "Main" }] as unknown as Bot["tasks"] },
      selected: false,
      onOpen: vi.fn(),
      onMenu: vi.fn(),
    }));

    expect(html).toContain('data-testid="working-dot"');
  });

  it("shows unread dot when chief has unread messages and is not working", () => {
    const html = renderToStaticMarkup(createElement(ChiefHero, {
      bot: { ...chief, unread: true },
      selected: false,
      onOpen: vi.fn(),
      onMenu: vi.fn(),
    }));

    expect(html).toContain('data-testid="unread-dot"');
  });
});
