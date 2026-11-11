/** A published page's id: lowercase letters and digits, the one folder name and URL segment it lives under. */
export const PAGE_ID = /^[a-z0-9]{20,63}$/;
/** What a page's files may be: the types the pages listener serves; the rest are left out of a page. */
export const PAGE_FILE_EXTENSIONS = new Set([
    "html", "htm", "css", "js", "mjs", "json", "txt", "csv", "md", "parquet", "arrow",
    "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "woff", "woff2", "ttf", "otf",
]);
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PAGE_MAX_FILES = 200;
