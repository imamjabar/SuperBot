import { useEffect, useState } from "react";
import type { CloudPlanBridge, CloudPlanSnapshot } from "../../electron/cloud-account.mjs";

export const CLOUD_PLAN_REFRESH_MS = 5 * 60_000;
const PLAN_CHANGED = "omb:cloud-plan-changed";
export const cloudPlanChanged = () => globalThis.window?.dispatchEvent?.(new Event(PLAN_CHANGED));

export function useCloudPlanSnapshot(bridge: CloudPlanBridge | undefined): CloudPlanSnapshot | null {
  const [plan, setPlan] = useState<CloudPlanSnapshot | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const stop = () => {
      active = false;
      unsubscribe?.();
      clearInterval(timer);
      window.removeEventListener?.("focus", read);
      window.removeEventListener?.(PLAN_CHANGED, read);
    };
    const read = () => {
      void bridge.state().then(
        next => { if (active) setPlan(next); },
        () => { if (active) setPlan({ status: "none" }); stop(); },
      );
    };
    unsubscribe = window.ogb?.cloudAccount?.onState(read);
    const timer = setInterval(read, CLOUD_PLAN_REFRESH_MS);
    window.addEventListener?.("focus", read);
    window.addEventListener?.(PLAN_CHANGED, read);
    read();
    return stop;
  }, [bridge]);
  return bridge ? plan : null;
}
