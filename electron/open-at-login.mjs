// The person's own "Open at login" choice: a login item that opens the app's window when they sign in to the computer.
import fs from "node:fs";
import path from "node:path";

/** Windows keeps one Run entry per name, so this app's login item has a name of its own. */
const CHOSEN_NAME = "OpenMausBot at login";

/** Desktop Entry Exec quoting: the path in double quotes, with ", `, $ and \ escaped. */
const quoted = (value) => `"${value.replace(/["`$\\]/g, (match) => `\\${match}`)}"`;

export function autostartEntry(exec) {
  return ["[Desktop Entry]", "Type=Application", "Name=OpenMausBot", `Exec=${quoted(exec)}`, "NoDisplay=true", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

/**
 * `chosen()` and `choose(on)`: the person's own login item; on Windows, whether Windows starts the app at sign-in at
 * all, as its Startup apps list shows.
 */
export function createOpenAtLogin({ app, platform = process.platform, env = process.env, home, execPath = process.execPath }) {
  const autostart = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "autostart", "openmausbot.desktop");
  /** Electron 43.7 on Windows: `launchItems` lists the entries that start this executable, each with its name,
   * arguments and whether Task Manager has it enabled. */
  const windowsStartsApp = () => (app.getLoginItemSettings().launchItems ?? []).filter(item => item.enabled !== false);
  return {
    available: () => app.isPackaged,
    chosen() {
      try {
        if (platform === "linux") return fs.existsSync(autostart);
        if (platform === "win32") return windowsStartsApp().length > 0;
        return app.getLoginItemSettings().openAtLogin === true;
      } catch { return false; }
    },
    choose(on) {
      if (!app.isPackaged) return;
      if (platform === "linux") {
        if (on) {
          fs.mkdirSync(path.dirname(autostart), { recursive: true });
          fs.writeFileSync(autostart, autostartEntry(env.APPIMAGE || execPath));
        } else fs.rmSync(autostart, { force: true });
        return;
      }
      if (platform === "win32") {
        if (on) app.setLoginItemSettings({ openAtLogin: true, args: [], name: CHOSEN_NAME });
        else for (const item of windowsStartsApp()) app.setLoginItemSettings({ openAtLogin: false, args: item.args ?? [], name: item.name });
        return;
      }
      app.setLoginItemSettings({ openAtLogin: on });
    },
  };
}

/** Settings' switch, on this computer's own page (`guard`); `changed` redraws the app menu's item. */
export function installOpenAtLogin({ ipcMain, guard, loginItem, changed }) {
  const state = () => ({ available: loginItem.available(), on: loginItem.chosen() });
  ipcMain.handle("open-at-login:state", guard("open-at-login:state", state));
  ipcMain.handle("open-at-login:set", guard("open-at-login:set", (_event, on) => { loginItem.choose(on === true); changed(); return state(); }));
}
