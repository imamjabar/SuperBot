/** A page a bot published to a public link, as its chat card shows it (WireMessage.publishedPage). The message's `text`
 * says the same in words, with the link, for every client that does not draw the card. */
export interface PublishedPageCard {
  /** live: the link works. unpublished: its owner took it down. limit: this server holds the most pages it can, so nothing
   * was published; `message` says so. */
  state: "live" | "unpublished" | "limit";
  title: string;
  pageId?: string;
  url?: string;
  /** This server's pages and its limit after this publish, as "3 of 500 pages". */
  usage?: { pages: number; limit: number };
  message?: string;
}

/** A published page's id: lowercase letters and digits, the one folder name and URL segment it lives under. */
export const PAGE_ID = /^[a-z0-9]{20,63}$/;

/** What a page's files may be: the types the pages listener serves; the rest are left out of a page. */
export const PAGE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "html", "htm", "css", "js", "mjs", "json", "txt", "csv", "md", "parquet", "arrow",
  "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "woff", "woff2", "ttf", "otf",
]);
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PAGE_MAX_FILES = 200;
