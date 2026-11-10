import assert from "node:assert/strict";
import { test } from "node:test";
import { pasteMenuItem } from "./paste-menu-item.mjs";

const params = { isEditable: true, editFlags: { canPaste: false } };
const clipboard = (types = []) => ({ has: async (type) => types.includes(type) });
const raw = (format) => `electron application/osclipboard;format="${format}"`;

test("image and Finder file clipboards get an explicit enabled paste action", async () => {
  for (const type of ["image/png", "text/uri-list", raw("public.file-url"), raw("NSFilenamesPboardType")]) {
    let pastes = 0;
    const item = await pasteMenuItem(params, clipboard([type]), { paste: () => pastes++ });
    assert.equal(item.enabled, true);
    assert.equal(item.role, undefined);
    item.click();
    assert.equal(pastes, 1);
  }
});

test("text paste keeps its native role without inspecting the clipboard", async () => {
  const item = await pasteMenuItem({ ...params, editFlags: { canPaste: true } }, null, null);
  assert.deepEqual(item, { label: "Paste", enabled: true, role: "paste" });
});

test("read-only targets, empty clipboards, and clipboard failures stay disabled", async () => {
  assert.equal((await pasteMenuItem({ ...params, isEditable: false }, null, null)).enabled, false);
  assert.equal((await pasteMenuItem(params, clipboard(), null)).enabled, false);
  assert.equal((await pasteMenuItem(params, { has: async () => { throw Error("unavailable"); } }, null)).enabled, false);
});
