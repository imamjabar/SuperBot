// The Local VM's settings, read from the config the server loaded.
import type { AppConfig } from "./config.ts";
import { seatCapacity } from "./local-vm-seats.ts";

export const DEFAULT_LOCAL_VM_MODE = "shared" as const;
export const DEFAULT_LOCAL_VM_MAX_INSTANCES = 2;
export const MIN_LOCAL_VM_MAX_INSTANCES = 1;
export const MAX_LOCAL_VM_MAX_INSTANCES = 8;
export const DEFAULT_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 480;
export const MIN_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 1_440;

export function localVmMode(cfg: AppConfig): "shared" | "per-bot" | "pool" {
  return cfg.localVm?.mode ?? DEFAULT_LOCAL_VM_MODE;
}

export function localVmMaxInstances(cfg: AppConfig): number {
  return cfg.localVm?.maxInstances ?? DEFAULT_LOCAL_VM_MAX_INSTANCES;
}

export function localVmIdleTimeoutMinutes(cfg: AppConfig): number {
  return cfg.localVm?.idleTimeoutMinutes ?? DEFAULT_LOCAL_VM_IDLE_TIMEOUT_MINUTES;
}

/** Seats share the one shared container, so only shared mode has more than one. */
export function localVmSeats(cfg: AppConfig): number {
  return localVmMode(cfg) === "shared" ? seatCapacity(cfg.localVm?.seats) : 1;
}

/** App preservation is deliberately opt-in: a normal image replacement keeps its existing small, predictable footprint. */
export function localVmPreservesInstalledApps(cfg: AppConfig): boolean {
  return cfg.localVm?.preserveInstalledApps === true;
}
