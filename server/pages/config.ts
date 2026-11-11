export interface PagesConfig {
  /** The loopback port the pages listener binds. */
  port: number;
  /** The origin published pages are served at, without a trailing slash; absent until the owner sets it. */
  publicUrl?: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** An origin only: https, or http on a loopback host (development and tests); no credentials, path, query or hash. */
export function normalizePagesOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const allowed = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!allowed || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /[?#]/.test(value)) return null;
  return url.origin;
}

/** Read once at startup: OMB_PAGES_PORT (default: the app's port + 2) and OMB_PAGES_PUBLIC_URL. */
export function readPagesConfig(env: NodeJS.ProcessEnv, appPort: number, warn: (line: string) => void = console.warn): PagesConfig {
  const port = Number(env.OMB_PAGES_PORT || appPort + 2);
  const raw = env.OMB_PAGES_PUBLIC_URL?.trim();
  if (!raw) return { port };
  const publicUrl = normalizePagesOrigin(raw);
  if (!publicUrl) {
    warn("OMB_PAGES_PUBLIC_URL ignored: it must be an origin such as https://pages.example.com (https, no path, query or credentials). Publishing pages stays off.");
    return { port };
  }
  return { port, publicUrl };
}
