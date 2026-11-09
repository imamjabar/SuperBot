import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider, type Group } from "@/state/store";
import { GroupThreadList } from "./SidebarGroupThreadList";
import { formatUpdatedAt } from "./SidebarThreadRow";
import { GroupTaskPicker } from "./TaskPicker";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => true,
}));

describe("group thread list", () => {
  it("exposes group history through the same nested thread rows and All threads picker", () => {
    const group: Group = { id: "team", threadId: "group-current", name: "Launch team", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1, messages: [],
      tasks: [{ threadId: "group-current", title: "Launch plan", createdAt: 3 }, { threadId: "group-old", title: "Previous review", createdAt: 2 }] };
    const markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupThreadList, { group, selected: true })));
    expect(markup).toContain('aria-label="Launch team threads"');
    expect(markup).toContain('data-sidebar-thread-row="group-current" aria-current="page"');
    expect(markup).toContain("Previous review");
    expect(markup).not.toContain("New thread");
    const picker = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupTaskPicker, { group })));
    expect(picker).toContain('aria-label="All threads"');
    expect(picker).not.toContain("Tasks");
    const working = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupThreadList, { group: { ...group, working: true }, selected: true })));
    expect(working).toContain(`title="Launch plan · ${formatUpdatedAt(3)} · Working"`);
    const archived = { ...group, tasks: [group.tasks![0]!, { ...group.tasks![1]!, archivedAt: 5 }] };
    const withArchived = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupThreadList, { group: archived, selected: true })));
    expect(withArchived).not.toContain("Previous review");
    expect(withArchived).toContain("Show all");
  });
});
