// What this desktop keeps whatever page its window shows, whichever port its own page is served on: the notices someone
// closed, its usage-analytics switch, the app's language, whether the person hid the window's rail of places and whether
// they turned the window's frame off.
import fs from "node:fs";
import { onboardingHints } from "./onboarding-record.mjs";
import { DEFAULT_TALK_KEY, isTalkKey } from "./talk-keys.mjs";
import { accountFullName } from "./system-name.mjs";

export { DESKTOP_PORTS } from "./desktop-ports.mjs";
/** The only notices a page may record, so no page can write anything else into the file. */
export const DESKTOP_NOTICES = Object.freeze(["whats-new-2026-11", "boat-credit-2026-11", "grok-move-2026-11"]);
const WHATS_NEW = DESKTOP_NOTICES[0];
/** A locale code such as "de" or "pt-br", or "" for following the system. */
const LANGUAGE = /^(?:[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2})?$/i;
const isLanguage = value => typeof value === "string" && value.length <= 24 && LANGUAGE.test(value);

/** Security: a write that fails (a full disk, a kill mid-write) leaves the last whole record, analytics opt-out included.
 * A file another tool saved with a byte-order mark (Notepad on Windows) still reads. */
export function jsonFile(file, files = fs) {
  return {
    read: () => JSON.parse(files.readFileSync(file, "utf8").replace(/^\uFEFF/, "")),
    write: value => {
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        files.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
        files.renameSync(temporary, file);
      } catch (error) {
        try { files.rmSync(temporary, { force: true }); } catch {}
        throw error;
      }
    },
  };
}

function parse(raw) {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const seen = Array.isArray(record.seen) ? DESKTOP_NOTICES.filter(id => record.seen.includes(id)) : [];
  return { seen, ...(typeof record.analytics === "boolean" ? { analytics: record.analytics } : {}),
    ...(isLanguage(record.language) ? { language: record.language } : {}),
    ...(typeof record.talkShortcut === "boolean" ? { talkShortcut: record.talkShortcut } : {}),
    ...(isTalkKey(record.talkKey) ? { talkKey: record.talkKey } : {}),
    ...(typeof record.railHidden === "boolean" ? { railHidden: record.railHidden } : {}),
    ...(typeof record.windowFrame === "boolean" ? { windowFrame: record.windowFrame } : {}) };
}

/** A record that cannot be written is still kept for this launch. */
export function createDesktopPrefs({ read, write }) {
  let record = null;
  const current = () => {
    if (record) return record;
    let raw = null;
    try { raw = read(); } catch {}
    return (record = parse(raw));
  };
  const save = next => { record = next; try { write(next); } catch {} };
  return {
    seen: () => [...current().seen],
    markSeen(id) {
      const saved = current();
      if (DESKTOP_NOTICES.includes(id) && !saved.seen.includes(id)) save({ ...saved, seen: [...saved.seen, id] });
    },
    /** null until a choice is saved. */
    analytics: () => current().analytics ?? null,
    setAnalytics(enabled) { save({ ...current(), analytics: enabled === true }); },
    /** null until a language is picked; "" is a pick too: follow the system. */
    language: () => current().language ?? null,
    setLanguage(language) {
      if (!isLanguage(language)) return false;
      if (current().language !== language) save({ ...current(), language });
      return true;
    },
    talkShortcut: () => current().talkShortcut ?? true,
    setTalkShortcut(enabled) { save({ ...current(), talkShortcut: enabled === true }); },
    talkKey: () => current().talkKey ?? DEFAULT_TALK_KEY,
    setTalkKey(id) {
      if (!isTalkKey(id)) return false;
      if (current().talkKey !== id) save({ ...current(), talkKey: id });
      return true;
    },
    /** The window's rail of places is shown until the person hides it. */
    railHidden: () => current().railHidden === true,
    setRailHidden(hidden) {
      const railHidden = hidden === true;
      if ((current().railHidden === true) !== railHidden) save({ ...current(), railHidden });
    },
    /** The window draws its own frame until the person turns it off. */
    windowFrame: () => current().windowFrame !== false,
    setWindowFrame(on) {
      const windowFrame = on !== false;
      if ((current().windowFrame !== false) !== windowFrame) save({ ...current(), windowFrame });
    },
  };
}

/**
 * `page(event)`: "local" for this computer's page, "server" for another saved server open in this desktop's window,
 * null for anything else. `localConfig()`: This computer's own workspace's config.json.
 * `languageChanged(language, sender)`: tells this desktop's other pages the language picked on one of them.
 */
export function registerDesktopPrefs({ prefs: given, ipcMain, read, write, page, localConfig = () => null, languageChanged = () => {}, frame = null, systemName = accountFullName }) {
  let prefs = given ?? null;
  const store = () => prefs ??= createDesktopPrefs({ read, write });
  const from = (channel, pages, handler) => (event, ...args) => {
    const asking = page(event);
    if (!pages.includes(asking)) throw new Error(`${channel} is only available in this app's window`);
    return handler(asking, ...args);
  };
  // This computer's workspace record counts on every page, before This computer's page has loaded.
  const state = () => {
    let hints = [];
    try { hints = onboardingHints(localConfig()); } catch {}
    const seen = store().seen(), closed = hints.includes(WHATS_NEW);
    return { seen: closed && !seen.includes(WHATS_NEW) ? [...seen, WHATS_NEW] : seen };
  };
  const ANY = ["local", "server"];
  ipcMain.handle("desktop-notices:state", from("desktop-notices:state", ANY, state));
  ipcMain.handle("desktop-notices:seen", from("desktop-notices:seen", ANY, (_, id) => store().markSeen(id)));
  // A first run's default name for the profile: this computer's own page only, never a server's.
  ipcMain.handle("desktop-profile:system-name", from("desktop-profile:system-name", ["local"], () => systemName()));
  // Security: a server's page learns only that this desktop turned analytics off, never that it is on.
  ipcMain.on("desktop-analytics:read", event => {
    try {
      const asking = page(event), saved = store().analytics();
      event.returnValue = asking === "local" ? saved : asking && saved === false ? false : null;
    } catch { event.returnValue = null; }
  });
  ipcMain.handle("desktop-analytics:set", from("desktop-analytics:set", ["local"], (_, enabled) => { store().setAnalytics(enabled === true); }));
  ipcMain.on("desktop-language:read", event => {
    try { event.returnValue = page(event) ? store().language() : null; } catch { event.returnValue = null; }
  });
  const setLanguage = from("desktop-language:set", ANY, (_, language) => {
    const before = store().language();
    return store().setLanguage(language) && before !== language;
  });
  ipcMain.handle("desktop-language:set", (event, language) => {
    if (setLanguage(event, language)) {
      try { languageChanged(language, event.sender); } catch {}
    }
    return store().language() === language;
  });
  // Every page of this desktop's window reads and sets the frame; a server's page sets it only from the person's click,
  // which the preload checks.
  const frameState = () => ({ on: store().windowFrame(), restart: Boolean(frame?.restarts) && frame.made() !== null && frame.made() !== store().windowFrame() });
  ipcMain.handle("window-frame:state", from("window-frame:state", ANY, () => frameState()));
  ipcMain.handle("window-frame:set", from("window-frame:set", ANY, (_, on) => {
    store().setWindowFrame(on === true);
    try { frame?.changed(); } catch {}
    return frameState();
  }));
}
