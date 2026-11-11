import { join } from "node:path";
import { PAGE_FILE_EXTENSIONS } from "../../shared/published-page.ts";

export const PAGE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._ ()+@-]{0,99}$/;
export const PAGE_MANIFEST = ".manifest.json";
export const PAGES_MAX_DEPTH = 10;

export const pagesRoot = (dataDir: string) => join(dataDir, "published-pages");

/** Security: the one check for a page file's relative path, run by the writer and again by the reader. Segments must start
 * with a letter, digit or underscore, so no `..`, no hidden file (the manifest is `.manifest.json`), no empty segment, no
 * backslash or NUL; the extension must be one a page may serve. Returns the segments, or null for a refused path. */
export function pageFileSegments(path: string): string[] | null {
  if (!path || path.length > 1024) return null;
  const segments = path.split("/");
  if (segments.length > PAGES_MAX_DEPTH) return null;
  for (const segment of segments) if (!PAGE_SEGMENT.test(segment) || segment.endsWith(".")) return null;
  const name = segments[segments.length - 1]!, dot = name.lastIndexOf(".");
  return dot > 0 && PAGE_FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? segments : null;
}
