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
  const { timeoutMs, signal, background: _background, headers, ...rest } = init ?? {};
  const sent = new Headers(headers ?? { "content-type": "application/json" });
  const res = await fetch(path, {
    ...rest,
    headers: sent,
    signal: timeoutMs === undefined
      ? signal
      : signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
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
