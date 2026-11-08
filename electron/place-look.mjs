import environments from "./environments.cjs";

export const CLOUD_SWATCH_COLORS = Object.freeze({ blue: "blue", green: "teal", amber: "yellow", rose: "red", violet: "purple", slate: null });
export const CLOUD_SWATCHES = Object.freeze(Object.keys(CLOUD_SWATCH_COLORS));

export const SIGNED_IN = "signed-in:";

export const swatchColor = (swatch) => (Object.hasOwn(CLOUD_SWATCH_COLORS, swatch) ? CLOUD_SWATCH_COLORS[swatch] : null);

export function swatchOf(color) {
  if (!environments.ENTRY_COLORS.includes(color)) return null;
  return CLOUD_SWATCHES.find((swatch) => CLOUD_SWATCH_COLORS[swatch] === color) ?? null;
}

export function placeLook(entry) {
  if (!entry) return null;
  const color = environments.ENTRY_COLORS.includes(entry.color) ? entry.color : null;
  const base = { name: entry.name, color, swatch: swatchOf(color) };
  if (entry.kind === "local") return { ...base, change: "local" };
  if (typeof entry.origin !== "string" || !entry.origin) return null;
  return { ...base, change: "local" };
}

export const railPaint = (look, color) => (look ? { swatch: swatchOf(color), ...(look.change ? {} : { locked: look.reason ?? "member" }) } : null);

export function pageLook(look) {
  return look ?? null;
}

export function installPlaceLook({ ipcMain, guard, place, save, rail = null }) {
  const look = () => placeLook(place());
  const recolor = async (entry, now, swatch) => {
    if (!(swatch === null || CLOUD_SWATCHES.includes(swatch))) throw new Error("Choose one of the colors.");
    const current = now();
    if (!current) throw new Error("This place has no color to change.");
    if (entry) save(entry.id, swatchColor(swatch));
    return { outcome: "saved", look: pageLook(now()) };
  };
  ipcMain.handle("workspaces:look", guard(() => pageLook(look())));
  ipcMain.handle("workspaces:color", guard((_event, swatch) => recolor(place(), look, swatch)));
  if (rail) {
    ipcMain.handle("workspaces:recolor", (event, id, swatch) => {
      if (!rail.owns(event)) throw new Error("workspaces:recolor is only available to the window's rail");
      if (!rail.places().some((listed) => listed.id === id && listed.paint)) return Promise.reject(new Error("That place isn't here any more."));
      const entry = rail.saved(id);
      const now = () => (entry ? placeLook(rail.saved(id) ?? entry) : null);
      return recolor(entry, now, swatch);
    });
  }
  return { look };
}
