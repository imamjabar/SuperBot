import { useEffect, useState } from "react";
import { openThread, type Action, type AppState, type ThreadTarget } from "@/state/store";
import { setNotificationOpenHandler } from "@/lib/notify";

export function takeNotificationTargetFromLocation(): ThreadTarget | null {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.search);
  const botId = params.get("open-bot");
  const threadId = params.get("open-thread");
  if (!botId || !threadId) return null;
  params.delete("open-bot");
  params.delete("open-thread");
  const search = params.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
  return { botId, threadId };
}

export function useNotificationOpen(state: AppState, dispatch: (action: Action) => void): void {
  const [target, setTarget] = useState<ThreadTarget | null>(takeNotificationTargetFromLocation);

  useEffect(() => {
    setNotificationOpenHandler(setTarget);
    return () => {
      setNotificationOpenHandler(null);
    };
  }, []);

  useEffect(() => {
    if (!target || !state.hydrated) return;
    setTarget(null);
    if (state.appSettingsOpen) dispatch({ type: "toggleAppSettings", open: false });
    if (state.shortcutsOpen) dispatch({ type: "toggleShortcuts", open: false });
    openThread(dispatch, target, state);
  }, [target, state, dispatch]);
}
