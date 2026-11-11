import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PAGE_ID, PAGE_MAX_BYTES, PAGE_MAX_FILES } from "../../shared/published-page.js";
import { PAGE_MANIFEST, pageFileSegments, pagesRoot } from "./paths.js";
export const PAGES_LIMIT = 500;
export const NO_PUBLIC_URL_MESSAGE = "Publishing pages needs a public address for pages. Set OMB_PAGES_PUBLIC_URL on the server.";
const LIMIT_MESSAGE = `This server already has ${PAGES_LIMIT} published pages. Unpublish some, then try again.`;
const ID_LENGTH = 26;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const fail = (reason, message, usage) => ({ ok: false, reason, message, ...(usage ? { usage } : {}) });
class Cancelled extends Error {
}
function newPageId() {
    let id = "";
    while (id.length < ID_LENGTH) {
        for (const byte of randomBytes(ID_LENGTH)) {
            if (byte < 252 && id.length < ID_LENGTH)
                id += ALPHABET[byte % ALPHABET.length];
        }
    }
    return id;
}
const exists = (dir) => readdir(dir).then(() => true, () => false);
/** Published pages on this server's own disk: `<dataDir>/published-pages/<pageId>/` holds the page's files and a manifest
 * of their paths. A publish writes a sibling temp folder and renames it into place, so the listener only ever sees a whole page. */
export function createPagesHost(options) {
    const root = pagesRoot(options.dataDir);
    const pageDir = (pageId) => join(root, pageId);
    let queue = Promise.resolve();
    let swept = false;
    // Mutations run one at a time, so the page count and the cap are exact.
    const serially = (work) => {
        const run = queue.then(work, work);
        queue = run.catch(() => undefined);
        return run;
    };
    const livePages = async () => {
        try {
            return (await readdir(root)).filter((name) => PAGE_ID.test(name)).length;
        }
        catch {
            return 0;
        }
    };
    const sweepLeftovers = async () => {
        if (swept)
            return;
        swept = true;
        for (const name of await readdir(root).catch(() => []))
            if (name.startsWith("."))
                await rm(join(root, name), { recursive: true, force: true });
    };
    const step = (call) => {
        call.assertActive?.();
        if (call.signal?.aborted)
            throw new Cancelled();
    };
    const validated = (files) => {
        if (!files.length)
            return fail("refused", "A page needs files.");
        if (files.length > PAGE_MAX_FILES)
            return fail("refused", `A page can have at most ${PAGE_MAX_FILES} files.`);
        const paths = new Set(), folded = new Set();
        let bytes = 0;
        for (const file of files) {
            if (!pageFileSegments(file.path))
                return fail("refused", `“${file.path.slice(0, 100)}” is not a file name or type a page can serve.`);
            if (folded.has(file.path.toLowerCase()))
                return fail("refused", `Two files are both named “${file.path}”.`);
            folded.add(file.path.toLowerCase());
            paths.add(file.path);
            bytes += file.data.byteLength;
        }
        if (bytes > PAGE_MAX_BYTES)
            return fail("refused", `A page can be at most ${PAGE_MAX_BYTES} bytes.`);
        if (!paths.has("index.html"))
            return fail("refused", "A page needs an index.html at its top.");
        return { paths: [...paths] };
    };
    const writePage = async (dir, files, paths, call) => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        for (const file of files) {
            step(call);
            const target = join(dir, ...file.path.split("/"));
            await mkdir(dirname(target), { recursive: true, mode: 0o700 });
            await writeFile(target, file.data, { mode: 0o600 });
        }
        step(call);
        await writeFile(join(dir, PAGE_MANIFEST), JSON.stringify({ version: 1, files: paths }), { mode: 0o600 });
    };
    const publishNow = async (files, pageId, call) => {
        const checked = validated(files);
        if ("ok" in checked)
            return checked;
        if (pageId !== undefined && !PAGE_ID.test(pageId))
            return fail("gone", "That page no longer exists.");
        await mkdir(root, { recursive: true, mode: 0o700 });
        await sweepLeftovers();
        const before = await livePages();
        let id = pageId;
        if (id === undefined) {
            if (before >= PAGES_LIMIT)
                return fail("limit", LIMIT_MESSAGE, { pages: before, limit: PAGES_LIMIT });
            do
                id = newPageId();
            while (await exists(pageDir(id)));
        }
        else if (!(await exists(pageDir(id)))) {
            return fail("gone", "That page no longer exists.");
        }
        const target = pageDir(id), temp = join(root, `.tmp-${randomBytes(8).toString("hex")}`);
        try {
            step(call);
            await writePage(temp, files, checked.paths, call);
            step(call);
            if (pageId === undefined) {
                await rename(temp, target);
            }
            else {
                const aside = join(root, `.old-${randomBytes(8).toString("hex")}`);
                await rename(target, aside);
                try {
                    await rename(temp, target);
                }
                catch (error) {
                    await rename(aside, target).catch(() => undefined);
                    throw error;
                }
                await rm(aside, { recursive: true, force: true });
            }
        }
        catch (error) {
            await rm(temp, { recursive: true, force: true });
            if (error instanceof Cancelled)
                return fail("unavailable", "Publishing was cancelled.");
            if (error instanceof Error && "code" in error)
                return fail("unavailable", "This server couldn't save the page to its disk.");
            throw error;
        }
        return { ok: true, pageId: id, url: `${options.publicUrl}/p/${id}/`, usage: { pages: pageId === undefined ? before + 1 : before, limit: PAGES_LIMIT }, badge: false };
    };
    const unpublishNow = async (pageId, call) => {
        if (!PAGE_ID.test(pageId) || !(await exists(pageDir(pageId))))
            return fail("gone", "That page no longer exists.");
        const aside = join(root, `.old-${randomBytes(8).toString("hex")}`);
        try {
            step(call);
            await rename(pageDir(pageId), aside);
            await rm(aside, { recursive: true, force: true });
        }
        catch (error) {
            if (error instanceof Cancelled)
                return fail("unavailable", "Unpublishing was cancelled.");
            if (error instanceof Error && "code" in error)
                return fail("unavailable", "This server couldn't remove the page from its disk.");
            throw error;
        }
        return { ok: true, pageId, usage: { pages: await livePages(), limit: PAGES_LIMIT } };
    };
    return {
        /** A new page (no `pageId`), or new files at an existing page's same link. */
        async publish(files, pageId, call = {}) {
            if (!options.publicUrl)
                return fail("unavailable", NO_PUBLIC_URL_MESSAGE);
            return serially(() => publishNow(files, pageId, call));
        },
        /** A local delete, so it works with no public address set. */
        unpublish(pageId, call = {}) {
            return serially(() => unpublishNow(pageId, call));
        },
    };
}
