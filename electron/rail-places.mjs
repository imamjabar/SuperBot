import environments from "./environments.cjs";
import { placeLook, railPaint } from "./place-look.mjs";

export const RAIL_MIN_PLACES = 2;

function plain(value) {
  return typeof value === "string" ? value.trim() : "";
}

function seen(place) {
  const { forget: _forget, server: _server, ...publicPlace } = place;
  return publicPlace;
}

function circle(entry, { activeId, waiting }) {
  const color = environments.ENTRY_COLORS.includes(entry.color) ? entry.color : null;
  const paint = railPaint(placeLook(entry), color);
  return {
    id: entry.id,
    name: entry.name,
    color,
    kind: "server",
    opens: true,
    ...(paint ? { paint } : {}),
    ...(entry.id === activeId ? { active: true } : {}),
    ...(waiting(entry.id) ? { attention: true } : {}),
    removable: true,
    forget: true,
    server: true,
  };
}

export function railPlaces({ saved, waiting = () => false }) {
  const activeId = saved.activeId;
  const localColor = environments.ENTRY_COLORS.includes(saved.localColor) ? saved.localColor : null;
  const localPaint = railPaint(placeLook({ id: environments.LOCAL_ID, kind: "local", name: "This computer", color: localColor }), localColor);

  const local = {
    id: environments.LOCAL_ID,
    name: "This computer",
    color: localColor,
    kind: "computer",
    opens: true,
    paint: localPaint ?? { swatch: null },
    ...(activeId === environments.LOCAL_ID ? { active: true } : {}),
  };

  const remote = (saved.environments ?? [])
    .filter((entry) => entry && entry.kind !== "local" && entry.origin)
    .map((entry) => circle(entry, { activeId, waiting }));

  const places = [local, ...remote];
  return places.length >= RAIL_MIN_PLACES ? places : [];
}

const CHOICES = Object.freeze(["link", "address"]);

export function installRail({
  ipcMain,
  guard,
  trusted,
  lists = trusted,
  beside = () => false,
  places,
  open,
  add,
  targets,
  forget = null,
}) {
  let sheetOpen = false;
  let sent = "";

  const listed = (channel, handler) =>
    ipcMain.handle(
      channel,
      guard((event, ...args) => {
        if (!lists(event)) throw new Error(`${channel} is only available in this app's window`);
        return handler(event, ...args);
      }),
    );

  const choices = () => ({ link: true, address: true, cloud: false, organization: false, account: false });

  ipcMain.handle(
    "workspaces:places",
    guard((event) =>
      lists(event)
        ? { places: places().map(seen), add: choices() }
        : { places: [], add: { link: false, address: false, cloud: false, organization: false, account: false }, ...(beside() ? { beside: true } : {}) },
    ),
  );

  listed("workspaces:open", (_event, id) => {
    const place = places().find((entry) => entry.id === plain(id) && entry.opens);
    if (!place) throw new Error("That place isn't here any more.");
    return open(place.id);
  });

  listed("workspaces:remove", async (_event, id) => {
    const place = places().find((entry) => entry.id === plain(id) && entry.removable && entry.forget);
    if (!place) throw new Error("That place isn't here any more.");
    return { outcome: forget ? ((await forget(place.id)) === false ? "failed" : "removed") : "unsupported" };
  });

  listed("workspaces:add", (_event, choice, link) => {
    if (!CHOICES.includes(choice) || !choices()[choice]) throw new Error("That isn't something to add here.");
    const pasted = choice === "link" ? plain(link).trim().slice(0, 4096) : "";
    return pasted ? add.run(choice, pasted) : add.run(choice);
  });

  return {
    sheetOpen: () => sheetOpen,
    changed() {
      const key = JSON.stringify([places(), choices(), beside()]);
      if (key === sent) return;
      sent = key;
      for (const target of targets()) if (target && !target.isDestroyed()) target.send("workspaces:changed");
    },
  };
}
