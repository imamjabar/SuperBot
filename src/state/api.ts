import { lacksAdminScope } from "../lib/admin-scope";
import { noteRefusedRequest } from "../lib/session-ended";

export class ApiError extends Error {
  readonly status: number;
  readonly body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiInit = RequestInit & { timeoutMs?: number; background?: boolean };

export async function api<T = any>(path: string, init?: ApiInit): Promise<T> {
  const sent = new Headers(init?.headers ?? { "content-type": "application/json" });
  const signal = init?.timeoutMs === undefined
    ? init?.signal
    : init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeoutMs)])
      : AbortSignal.timeout(init.timeoutMs);
  const res = await fetch(path, {
    ...init,
    headers: sent,
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body?.error;
    const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : `${res.status} ${res.statusText}`;
    const refused = new ApiError(message, res.status, body);
    if (res.status === 401 || (res.status === 403 && !lacksAdminScope(refused))) noteRefusedRequest();
    throw refused;
  }
  return body;
}

export function snapshotArrays<T>(answer: T, ...keys: (keyof T)[]): T {
  for (const key of keys) if (!Array.isArray(answer[key])) throw new Error(`Invalid snapshot: ${String(key)} is not a list`);
  return answer;
}
