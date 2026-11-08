export interface SharedFolder { id: string; name: string; path: string; write: boolean; /** The person's whole home folder. */ home?: boolean }
export interface SharingState {
  enabled: boolean;
  folders: SharedFolder[];
  terminal: boolean;
  computer: boolean;
  connected?: boolean;
  error?: string;
}
interface Workspace { id: string; name: string; origin: string }
interface Identity { sessionId: string; environmentId: string }
export interface LendingActivityEntry {
  at: number;
  server: string;
  origin: string;
  action: string;
  detail: string;
  ok: boolean;
  error?: string;
}
export function isHomeFolder(target: string): Promise<boolean>;
export function existingFolders<T>(folders: unknown[], validate: (folders: unknown[]) => Promise<T[]>): Promise<T[]>;
export function validateSharedFolders(folders: unknown): Promise<SharedFolder[]>;
export function validSharedOperation(operation: unknown, computerId: string): boolean;
export function createComputerSharing(options: {
  file: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  environments: () => Workspace[];
  enabled?: () => Promise<boolean>;
  protectedPaths?: string[];
  /** The desktop's cua connection, or why it did not start (`reason` stays on this computer). */
  cuaConnection: () => Promise<{ mcpCommand: string; mcpArgs: string[]; mcpEnv?: Record<string, string> } | { mode: "unavailable"; reason: string } | null>;
  hostControl?: (id: string, signal: AbortSignal) => Promise<{ renew(): Promise<unknown>; release(): Promise<unknown> }>;
  /** The OS reports the screen locked: a screen action is refused with the fix instead of failing in the driver. */
  screenLocked?: () => boolean;
  /** Seconds since the person last touched this computer, or null when the system cannot tell: while they are using it,
   * a lent screen call that would take their mouse, keyboard or front window waits, and background calls run. */
  idleSeconds?: () => number | null;
  /** Home directory whose credential and autostart locations are protected. */
  home?: string;
  activityFile?: string;
  now?: () => number;
}): {
  state(id: string): SharingState;
  activity(id?: string, limit?: number): LendingActivityEntry[];
  identity(env: Workspace): Promise<Identity>;
  observe(env: Workspace): Promise<Identity | null>;
  decline(env: Workspace, identity: Identity): void;
  save(env: Workspace, input: Pick<SharingState, "folders" | "terminal" | "computer">, identity: Identity): Promise<SharingState>;
  revoke(env: Workspace): SharingState;
  forget(env: Workspace): void;
  /** A server is using this computer now: a job is running on it. */
  busy(): boolean;
  start(options?: { maintainer?: boolean }): void;
  close(): void;
};
export function sharedCuaConnection(connection: unknown): { mcpCommand: string; mcpArgs: string[]; mcpEnv?: Record<string, string> } | null;
