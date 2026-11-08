import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createSharedCua, executeSharedOperation, personalSecretPaths, sharedComputerError, validCommandSeconds } from "./shared-computer-access.mjs";
import { sharedCuaConnection } from "./shared-cua-connection.mjs";
export { sharedCuaConnection };
import { createLendingActivity, describeSharedOperation } from "./lending-activity.mjs";
import { cuaUnavailable, SCREEN_LOCKED } from "./lent-screen-failures.mjs";
import { createLentScreenPresence } from "./lent-screen-presence.mjs";
import { BACKGROUND_HEADERS } from "./place-inbox-watch.mjs";
import { shareableDrive } from "./shared-drives.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const DATA_VOLUME = "/System/Volumes/Data";
const identify = async candidate => { const info = await fsp.stat(candidate, { bigint: true }); return `${info.dev}:${info.ino}`; };

/** macOS reaches one home through a firmlink and again under the data volume, with different ancestors: walk both. */
function homeCandidates() {
  const home = path.resolve(os.homedir());
  const seeds = [home];
  if (process.platform === "darwin" && !home.startsWith(`${DATA_VOLUME}${path.sep}`)) seeds.push(path.join(DATA_VOLUME, home));
  return seeds;
}

/** {dev, ino}, not text: text misses firmlinks, bind mounts, case-insensitive spellings, Unicode normalization and 8.3/UNC names. */
async function enclosingHomeIdentities() {
  const identities = new Set();
  const [home, ...aliases] = homeCandidates();
  const canonicalHome = await fsp.realpath(home);
  const homeIdentity = await identify(canonicalHome);
  const roots = [canonicalHome];
  for (const alias of aliases) {
    try {
      const canonical = await fsp.realpath(alias);
      if ((await identify(canonical)) === homeIdentity) roots.push(canonical);
    } catch (error) {
      // Only the optional macOS data-volume spelling may be absent; any other failure must not shrink the home boundary.
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
  for (let current of roots) {
    for (;;) {
      identities.add(await identify(current));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return identities;
}

/** Sharing a drive letter, root or mount point shares a whole volume; unreadable parents fail closed. */
async function volumeRoot(canonical) {
  const parent = path.dirname(canonical);
  if (parent === canonical) return true;
  try { return (await fsp.stat(parent, { bigint: true })).dev !== (await fsp.stat(canonical, { bigint: true })).dev; } catch { return true; }
}

/** Whether `target` is exactly the person's home folder. Only the home folder itself may be lent on request (see
 * `home` in validateSharedFolders); the folders above it, and the system disk, never can. */
export async function isHomeFolder(target) {
  try {
    const [home] = homeCandidates();
    return (await identify(await fsp.realpath(target))) === (await identify(await fsp.realpath(home)));
  } catch { return false; }
}

const GONE = new Set(["ENOENT", "ENOTDIR"]);

/** The folders that still exist and pass the checks a folder chosen by hand passes. One moved or deleted since is left
 * out; any other refusal (the whole home folder, a file) still fails. */
export async function existingFolders(folders, validate) {
  const found = await Promise.all(folders.map((folder) => validate([folder]).then((list) => list[0] ?? null, (error) => {
    if (GONE.has(error?.code)) return null;
    throw error;
  })));
  return found.filter(Boolean);
}

/** The home folder is always lent read only, whatever editing it asks for. */
export async function validateSharedFolders(folders) {
  if (!Array.isArray(folders) || folders.length > 20) throw Object.assign(new Error("Choose at most 20 shared folders"), { code: "TOO_MANY" });
  const result = [];
  const enclosing = await enclosingHomeIdentities();
  for (const folder of folders) {
    if (!uuid(folder?.id) || typeof folder.path !== "string" || !path.isAbsolute(folder.path) || typeof folder.write !== "boolean") throw Object.assign(new Error("Choose folders using the desktop folder picker"), { code: "NOT_PICKED" });
    const canonical = await fsp.realpath(folder.path);
    if (!(await fsp.stat(canonical)).isDirectory()) throw Object.assign(new Error("Choose a folder, not a file"), { code: "NOT_FOLDER" });
    // The home folder, everything above it and the system disk are never shared. A separate drive (an external disk, a data
    // disk on a server, a drive letter) may be shared whole; any other mount point is still refused.
    // The home folder itself is lent only when asked for by name (`home: true`); anything above it, and the system disk,
    // are refused whatever is asked. Security: with editing, a write through it still never reaches its hidden files,
    // Library or AppData (insideHomeSettings), where shell start-up files and ~/.ssh live.
    const home = folder.home === true && await isHomeFolder(canonical);
    if (!home && (enclosing.has(await identify(canonical)) || ((await volumeRoot(canonical)) && !(await shareableDrive(canonical))))) throw Object.assign(new Error("Choose specific folders or a separate drive, not the entire computer or home folder"), { code: "HOME_OR_ROOT" });
    if (result.some(entry => entry.id === folder.id || entry.path === canonical)) continue;
    result.push({ id: folder.id, path: canonical, name: path.basename(canonical).slice(0, 120), write: home ? false : folder.write, ...(home ? { home: true } : {}) });
  }
  return result;
}

const JOB_KEYS = new Set(["computer_id", "action", "folder_id", "path", "content", "encoding", "expected_sha256", "old_text", "new_text", "command", "timeout_seconds", "tool_name", "arguments"]);
const JOB_ACTIONS = new Set(["list_files", "read_file", "write_file", "edit_file", "append_file", "delete_file", "run_command", "computer_tools", "computer_call"]);
const optionalText = (value, max) => value === undefined || (typeof value === "string" && value.length <= max);
/** Refuses malformed input only; the grant still decides whether the operation is allowed. */
export function validSharedOperation(operation, computerId) {
  return Boolean(operation) && typeof operation === "object" && !Array.isArray(operation) &&
    Object.keys(operation).every(key => JOB_KEYS.has(key)) &&
    operation.computer_id === computerId && JOB_ACTIONS.has(operation.action) &&
    (operation.folder_id === undefined || uuid(operation.folder_id)) &&
    optionalText(operation.path, 2048) && optionalText(operation.content, 350_000) &&
    optionalText(operation.old_text, 350_000) && optionalText(operation.new_text, 350_000) &&
    (operation.encoding === undefined || operation.encoding === "utf8" || operation.encoding === "base64") &&
    (operation.expected_sha256 === undefined || (typeof operation.expected_sha256 === "string" && /^[a-f0-9]{64}$/.test(operation.expected_sha256))) &&
    optionalText(operation.command, 8000) && validCommandSeconds(operation.timeout_seconds) && optionalText(operation.tool_name, 100) &&
    (operation.arguments === undefined || (Boolean(operation.arguments) && typeof operation.arguments === "object" && !Array.isArray(operation.arguments)));
}

/** Outbound HTTPS only: no local listening port, and pairing cookies and the connector secret stay in Electron. */
export function createComputerSharing({ file, fetch: fetchImpl, environments, cuaConnection, hostControl, screenLocked = () => false, idleSeconds = () => null, protectedPaths = [], enabled = async () => false, home = os.homedir(), activityFile, now = Date.now }) {
  const protectedRoots = [path.dirname(file), ...protectedPaths.filter(entry => typeof entry === "string" && entry), ...personalSecretPaths(home)];
  const activity = createLendingActivity(activityFile ?? path.join(path.dirname(file), "lending-activity.jsonl"));
  const presence = createLentScreenPresence({ idleSeconds, now });
  let records = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed?.version === 1 && parsed.records && typeof parsed.records === "object") {
      records = Object.fromEntries(Object.entries(parsed.records).filter(([, record]) => !record?.cloud));
    }
  } catch {}
  const running = new Map();
  const grantVersions = new Map();
  const changeGrant = id => { const version = (grantVersions.get(id) ?? 0) + 1; grantVersions.set(id, version); return version; };
  const status = new Map();
  let closed = false;
  let maintainerOff = false;
  let executing = false;
  // A remote workspace's capability is not authority here: recheck the local gate (maintainer grants only).
  const requireEnabled = async () => {
    const allowed = !closed && !maintainerOff && await enabled().catch(() => false);
    if (allowed && !closed && !maintainerOff) return;
    maintainerOff = true;
    for (const env of environments()) {
      if (!running.has(env.id)) continue;
      if (status.get(env.id)?.connected) disconnect(env, records[env.id]); else stop(env.id);
    }
    throw new Error("Computer sharing is turned off on this computer. Restart the desktop after enabling it.");
  };
  const store = next => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, records: next }), { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file); records = next;
  };
  const request = async (env, route, body, signal, secret) => {
    const origin = new URL(env.origin);
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error("Computer sharing requires an HTTPS server address");
    const response = await fetchImpl(`${env.origin}${route}`, {
      method: body === undefined ? "GET" : "POST", credentials: "include", redirect: "error", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(10_000),
      headers: { origin: env.origin, ...BACKGROUND_HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(secret ? { "x-omb-computer-secret": secret } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length; if (bytes > 4_000_000) throw new Error("Server response exceeded limit");
      chunks.push(Buffer.from(chunk));
    }
    let json; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("This server does not support computer sharing. Update its SuperBot installation."); }
    if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? "Pair this desktop again before sharing computer access." : `Server request failed (${response.status}). Update the server if needed.`), { status: response.status });
    return json;
  };
  const describe = async env => {
    const [auth, descriptor] = await Promise.all([request(env, "/api/auth/session"), request(env, "/.well-known/superbot/environment")]);
    if (auth.kind !== "session" || !uuid(auth.id) || !uuid(descriptor.environmentId)) throw new Error("Complete server pairing or sign-in first");
    if (descriptor.capabilities?.sharedComputers !== true) throw new Error("Update this server to enable computer sharing");
    return { info: { sessionId: auth.id, environmentId: descriptor.environmentId }, edits: descriptor.capabilities?.fileEdits === true };
  };
  const supportsEdits = new Set();
  const identity = async env => {
    await requireEnabled();
    const { info, edits } = await describe(env);
    await requireEnabled();
    if (edits) supportsEdits.add(env.id); else supportsEdits.delete(env.id);
    return info;
  };
  const matches = (grant, info) => grant?.sessionId === info.sessionId && grant?.environmentId === info.environmentId;
  const stop = id => {
    const live = running.get(id);
    if (live) { live.abort.abort(); live.cua?.close(); running.delete(id); }
    status.set(id, { connected: false });
  };
  const run = (env, grant) => {
    stop(env.id);
    if (closed || !grant.enabled || maintainerOff) return;
    const live = { abort: new AbortController(), cua: null };
    running.set(env.id, live);
    const signal = live.abort.signal;
    const call = (action, body = {}, held = signal) => request(env, `/api/shared-computers/${grant.id}/${action}`, body, held, grant.secret);
    void (async () => {
      while (!signal.aborted) {
        try {
          await requireEnabled();
          if (!matches(grant, await identity(env))) throw new Error("Server sign-in changed. Review computer access again in Settings.");
          // A folder deleted since is left out, so the rest keeps working; any other refusal still stops lending.
          const present = new Set((await existingFolders(grant.folders, validateSharedFolders)).map(folder => folder.id));
          const folders = grant.folders.filter(folder => present.has(folder.id));
          const effectiveGrant = { ...grant, folders, protectedPaths: protectedRoots };
          await requireEnabled();
          await request(env, "/api/shared-computers/connect", {
            id: grant.id, name: os.hostname().slice(0, 120), environmentId: grant.environmentId,
            folders: folders.map(({ id, name, write }) => ({ id, name, write })), terminal: grant.terminal, computer: grant.computer,
            ...(supportsEdits.has(env.id) ? { fileEdits: true } : {}),
          }, signal, grant.secret);
          if (signal.aborted) break;
          status.set(env.id, { connected: true });
          while (!signal.aborted) {
            await requireEnabled();
            const { job } = await call("poll", {}, signal);
            await requireEnabled();
            if (!job) continue;
            if (!uuid(job.id)) throw new Error("Invalid computer request");
            if (!validSharedOperation(job.operation, grant.id)) {
              activity.record({ env, action: "invalid", detail: "", ok: false, error: "Refused a malformed request" });
              await call("result", { jobId: job.id, result: sharedComputerError(new Error("Invalid computer request")) });
              continue;
            }
            if (executing) { await call("result", { jobId: job.id, result: sharedComputerError(new Error("This computer is busy with another server")) }); continue; }
            executing = true;
            const jobAbort = new AbortController();
            const jobSignal = AbortSignal.any([signal, jobAbort.signal]);
            let leasing = false, ended = false, renewal = null;
            let control;
            const lease = async () => {
              if (leasing) return;
              leasing = true;
              try {
                await requireEnabled();
                if (!(await call("lease", { jobId: job.id })).active) jobAbort.abort();
                if (!ended) await (renewal = control?.renew());
              } catch { jobAbort.abort(); }
              finally { leasing = false; renewal = null; }
            };
            const heartbeat = setInterval(() => void lease(), 1000);
            let result;
            try {
              await lease(); jobSignal.throwIfAborted();
              // Listing the tools never touches the screen, so only a call takes this computer's screen lock.
              if (grant.computer && job.operation.action === "computer_call") {
                if (screenLocked()) throw new Error(SCREEN_LOCKED);
                const waits = presence.refusal(job.operation.tool_name, job.operation.arguments);
                if (waits) throw new Error(waits);
                if (!hostControl) throw new Error("The local computer control gate is unavailable");
                control = await hostControl(job.id, jobSignal);
                jobSignal.throwIfAborted();
              }
              result = await executeSharedOperation(effectiveGrant, job.operation, jobSignal, async () => {
                if (!live.cua) {
                  const connection = await cuaConnection();
                  jobSignal.throwIfAborted();
                  const mcp = sharedCuaConnection(connection);
                  if (!mcp) throw new Error(cuaUnavailable(connection?.reason));
                  live.cua = createSharedCua(mcp);
                }
                return live.cua;
              });
            } catch (error) { result = sharedComputerError(error); live.cua?.close(); live.cua = null; }
            finally {
              clearInterval(heartbeat); ended = true;
              if (control) presence.acted(job.operation.tool_name, job.operation.arguments);
              await renewal?.catch(() => {});
              await control?.release().catch(() => {});
              executing = false;
            }
            activity.record({
              env, action: job.operation.action, detail: describeSharedOperation(grant, job.operation), ok: result?.isError !== true,
              error: result?.isError === true ? result?.content?.[0]?.text : undefined,
            });
            // Never retry an action if the result delivery fails.
            await call("result", { jobId: job.id, result });
          }
        } catch (error) {
          if (!signal.aborted) status.set(env.id, { connected: false, error: error.message });
        }
        try { await delay(5000, undefined, { signal }); } catch { break; }
      }
    })().catch(() => {});
  };
  const state = id => {
    const grant = records[id];
    return { enabled: grant?.enabled === true, folders: Array.isArray(grant?.folders) ? grant.folders : [], terminal: grant?.enabled === true && grant.terminal === true, computer: grant?.computer === true, ...status.get(id) };
  };
  const disconnect = (env, grant) => {
    stop(env.id);
    if (!grant?.secret) return;
    void request(env, `/api/shared-computers/${grant.id}/disconnect`, {}, undefined, grant.secret).catch(() => {});
  };
  const validRecord = grant => grant?.enabled === true && uuid(grant.id) && /^[a-f0-9]{64}$/.test(grant.secret) && Array.isArray(grant.folders) && uuid(grant.sessionId) && uuid(grant.environmentId);
  return {
    state, identity,
    activity(id, limit) {
      const env = id === undefined ? null : environments().find(entry => entry.id === id);
      const entries = activity.list(env ? 500 : limit);
      return (env ? entries.filter(entry => entry.origin === env.origin) : entries).slice(0, limit ?? 100);
    },
    async observe(env) {
      const info = await identity(env);
      if (matches(records[env.id], info)) return null;
      disconnect(env, records[env.id]);
      return info;
    },
    decline(env, info) { changeGrant(env.id); disconnect(env, records[env.id]); store({ ...records, [env.id]: { ...info, enabled: false, folders: [], terminal: false, computer: false } }); },
    async save(env, input, info) {
      const version = changeGrant(env.id);
      const fresh = await identity(env);
      if (!matches(info, fresh)) throw new Error("Server sign-in changed. Review computer access again.");
      const folders = await validateSharedFolders(input.folders);
      await requireEnabled();
      const grant = { ...fresh, id: randomUUID(), secret: randomBytes(32).toString("hex"), enabled: true, folders, terminal: input.terminal === true, computer: input.computer === true };
      if (!folders.length && !grant.terminal && !grant.computer) throw new Error("Choose at least one folder or capability to share");
      if (grantVersions.get(env.id) !== version) return state(env.id);
      disconnect(env, records[env.id]);
      store({ ...records, [env.id]: grant }); run(env, grant); return state(env.id);
    },
    /** A server is using this computer now: a job is running on it. */
    busy: () => executing,
    revoke(env) {
      changeGrant(env.id);
      disconnect(env, records[env.id]);
      if (records[env.id]) store({ ...records, [env.id]: { ...records[env.id], enabled: false } });
      return state(env.id);
    },
    forget(env) { changeGrant(env.id); disconnect(env, records[env.id]); const next = { ...records }; delete next[env.id]; store(next); },
    start({ maintainer = true } = {}) {
      if (!maintainer || maintainerOff) return;
      for (const env of environments()) {
        const grant = records[env.id];
        if (validRecord(grant)) run(env, grant);
      }
    },
    close() { closed = true; for (const id of running.keys()) stop(id); },
  };
}
