import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { autostartEntry, createOpenAtLogin, installOpenAtLogin } from "./open-at-login.mjs";

/** Electron's login item API on macOS and Windows: one item per name, as Windows keeps one Run entry per name. */
function fakeApp({ openAtLogin = false, isPackaged = true } = {}) {
  const items = new Map(openAtLogin ? [["OpenMausBot", { args: [] }]] : []);
  return {
    isPackaged, items,
    getLoginItemSettings() {
      return { openAtLogin: items.size > 0, launchItems: [...items].map(([name, item]) => ({ name, args: item.args, enabled: true })) };
    },
    setLoginItemSettings({ openAtLogin: on, args = [], name = "OpenMausBot" }) { if (on) items.set(name, { args }); else items.delete(name); },
  };
}

const temp = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), "omb-open-at-login-")); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test("macOS: the person's own login item is on once chosen and off once unchosen", async t => {
  const dir = await temp(t);
  const app = fakeApp();
  const login = createOpenAtLogin({ app, platform: "darwin", home: dir });
  assert.equal(login.chosen(), false);
  login.choose(true);
  assert.equal(login.chosen(), true);
  login.choose(false);
  assert.equal(app.getLoginItemSettings().openAtLogin, false);
});

test("Windows: the person's item has a name of its own", async t => {
  const dir = await temp(t);
  const app = fakeApp();
  const login = createOpenAtLogin({ app, platform: "win32", home: dir });
  login.choose(true);
  assert.equal(login.chosen(), true);
  assert.deepEqual(app.items.get("OpenMausBot at login"), { args: [] });
  login.choose(false);
  assert.equal(login.chosen(), false);
});

/** Electron 43's login item API on Windows: one Run entry per name (the AppUserModelId unless named), `openAtLogin` true
 * only for that default entry with exactly the asked `args`, and `launchItems` listing every entry for this executable. */
function windowsApp(entries = []) {
  const items = new Map(entries.map(({ name, args = [], enabled = true }) => [name, { args, enabled }]));
  const DEFAULT = "electron.app.OpenMausBot";
  return {
    isPackaged: true, items,
    getLoginItemSettings() {
      return { openAtLogin: Boolean(items.get(DEFAULT)), launchItems: [...items].map(([name, item]) => ({ name, path: "C:\\OpenMausBot\\OpenMausBot.exe", args: item.args, scope: "user", enabled: item.enabled })) };
    },
    setLoginItemSettings({ openAtLogin: on, args = [], name = DEFAULT }) { if (on) items.set(name, { args, enabled: true }); else items.delete(name); },
  };
}

test("Windows: Settings shows on while Windows already starts the app", async t => {
  const dir = await temp(t);
  const app = windowsApp([{ name: "electron.app.OpenMausBot" }]);
  const login = createOpenAtLogin({ app, platform: "win32", home: dir });
  const handlers = new Map();
  installOpenAtLogin({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: (_channel, handler) => handler, loginItem: login, changed: () => {} });
  assert.deepEqual(await handlers.get("open-at-login:state")({}), { available: true, on: true });
  app.items.get("electron.app.OpenMausBot").enabled = false;
  assert.equal(login.chosen(), false, "an entry turned off in Task Manager starts nothing");
});

test("Windows: turning it off removes every entry that starts the app", async t => {
  const dir = await temp(t);
  const app = windowsApp([{ name: "electron.app.OpenMausBot" }, { name: "OpenMausBot at login" }]);
  const login = createOpenAtLogin({ app, platform: "win32", home: dir });
  login.choose(false);
  assert.deepEqual([...app.items.keys()], []);
  login.choose(true);
  assert.deepEqual([...app.items], [["OpenMausBot at login", { args: [], enabled: true }]]);
});

test("Linux: the person's autostart entry is written when chosen and removed when unchosen", async t => {
  const dir = await temp(t);
  const config = path.join(dir, "config");
  const entry = path.join(config, "autostart", "openmausbot.desktop");
  const login = createOpenAtLogin({ app: fakeApp(), platform: "linux", home: dir, env: { XDG_CONFIG_HOME: config, APPIMAGE: "/home/me/OpenMausBot.AppImage" } });
  login.choose(true);
  assert.equal(await readFile(entry, "utf8"), autostartEntry("/home/me/OpenMausBot.AppImage"));
  assert.equal(login.chosen(), true);
  login.choose(false);
  assert.equal(existsSync(entry), false);
});

test("a build that cannot add a login item offers no switch and changes nothing", async t => {
  const dir = await temp(t);
  const app = fakeApp({ isPackaged: false });
  const login = createOpenAtLogin({ app, platform: "darwin", home: dir });
  const handlers = new Map();
  let redraws = 0;
  installOpenAtLogin({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: (_channel, handler) => handler, loginItem: login, changed: () => redraws++ });
  assert.deepEqual(await handlers.get("open-at-login:state")({}), { available: false, on: false });
  await handlers.get("open-at-login:set")({}, true);
  assert.equal(app.getLoginItemSettings().openAtLogin, false);
  const packaged = createOpenAtLogin({ app: fakeApp(), platform: "darwin", home: dir });
  installOpenAtLogin({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, guard: (_channel, handler) => handler, loginItem: packaged, changed: () => redraws++ });
  assert.deepEqual(await handlers.get("open-at-login:set")({}, true), { available: true, on: true });
  assert.deepEqual(await handlers.get("open-at-login:set")({}, "yes"), { available: true, on: false }, "only a real true turns it on");
  assert.equal(redraws, 3, "the app menu's item is drawn again after each change");
});
