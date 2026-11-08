import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cleanWorkspaceDir, createCleanWorkspace } from "./clean-workspace.mjs";
import { WELCOME_VERSION } from "./onboarding-record.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

function computer(t, { frozen = { v: 1, at: 1 } } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "omb-clean-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dataDir = join(parent, ".openmausbot");
  const w = { dataDir, cleanDir: cleanWorkspaceDir(dataDir), running: dataDir, swaps: [], requests: [], swapFails: false, changes: 0 };
  mkdirSync(dataDir, { recursive: true });
  w.write = (name, text) => { writeFileSync(join(dataDir, name), text); };
  w.clean = createCleanWorkspace({
    dataDir: () => dataDir, running: () => w.running,
    swap: async (dir) => { w.swaps.push(dir); if (w.swapFails) return { ok: false, error: "switch-failed" }; await new Promise((resolve) => setImmediate(resolve)); w.running = dir; return { ok: true }; },
    changed: () => { w.changes++; },
  });
  w.request = async (route, init) => { w.requests.push([w.running, (init?.method ?? "GET").toUpperCase(), route]); return json({ frozen: w.running === dataDir && Boolean(frozen) }); };
  if (frozen) w.write("moved.json", JSON.stringify(frozen));
  w.write("environment-id", "own-copy-id\n");
  return w;
}

test("a clean workspace sits beside the data folder, never in it: a move carries that folder and forgetting the copy empties it", () => {
  assert.equal(cleanWorkspaceDir("/Users/a/.openmausbot"), "/Users/a/.openmausbot-clean");
});

test("opening it starts the server on its own folder, once, set up so the new-user setup never shows", async (t) => {
  const w = computer(t);
  w.write("config.json", JSON.stringify({ language: "de", providers: { key: "secret-of-the-frozen-copy" } }));
  assert.equal(w.clean.active(), false);
  assert.equal(await w.clean.enter(), true);
  assert.deepEqual(w.swaps, [w.cleanDir]);
  assert.equal(w.clean.active(), true);
  assert.equal(w.changes, 1, "what depends on it looks again");
  const config = JSON.parse(readFileSync(join(w.cleanDir, "config.json"), "utf8"));
  assert.equal(config.language, "de");
  assert.equal(config.onboarding.version, WELCOME_VERSION);
  assert.ok(config.onboarding.completedAt);
  assert.equal(JSON.stringify(config).includes("secret"), false, "nothing but the language comes from the frozen copy's config");
  assert.equal(await w.clean.enter(), true);
  assert.deepEqual(w.swaps, [w.cleanDir], "already there");
});

test("leaving brings the server back to this computer's data folder", async (t) => {
  const w = computer(t);
  assert.equal(await w.clean.leave(), true);
  assert.deepEqual(w.swaps, [], "already on this computer's own copy");
  await w.clean.enter();
  assert.equal(await w.clean.leave(), true);
  assert.deepEqual(w.swaps, [w.cleanDir, w.dataDir]);
  assert.equal(w.clean.active(), false);
});

test("a clean workspace is refused while a named local environment runs", async (t) => {
  const w = computer(t);
  w.running = "/Users/a/lab";
  assert.equal(await w.clean.enter(), true);
  assert.deepEqual(w.swaps, [], "a named local environment stays");
});

test("a failure to start the clean workspace leaves the server as it was, and enter answers false", async (t) => {
  const w = computer(t);
  w.swapFails = true;
  assert.equal(await w.clean.enter(), false);
  assert.equal(w.clean.active(), false);
});

test("one swap at a time: open, leave and open again at once end where the last asked, each after the one before", async (t) => {
  const w = computer(t);
  const order = [w.clean.enter(), w.clean.leave(), w.clean.enter()];
  assert.deepEqual(await Promise.all(order), [true, true, true]);
  assert.deepEqual(w.swaps, [w.cleanDir, w.dataDir, w.cleanDir]);
  assert.equal(w.clean.active(), true);
});

test("the marker is the frozen copy's own, read from its folder whichever server runs", async (t) => {
  const w = computer(t, { frozen: { v: 1, at: 1, place: "Garage" } });
  await w.clean.enter();
  assert.deepEqual(w.clean.marker(), { frozen: true, place: "Garage" });
  w.write("moved.json", "not json");
  assert.deepEqual(w.clean.marker(), { frozen: true }, "as the server reads it: a marker it can't read is still frozen");
  rmSync(join(w.dataDir, "moved.json"));
  assert.deepEqual(w.clean.marker(), { frozen: false });
});

test("the move's server, while the clean workspace runs: the copy's own marker and identity from its files, everything else refused", async (t) => {
  const w = computer(t);
  const request = w.clean.realCopy(w.request);
  await request("/api/bots?messages=0");
  assert.deepEqual(w.requests, [[w.dataDir, "GET", "/api/bots?messages=0"]], "its own copy running: passed on");
  w.requests.length = 0;
  await w.clean.enter();
  assert.deepEqual(await (await request("/api/move/freeze")).json(), { frozen: true });
  assert.deepEqual(await (await request("/.well-known/openmausbot/environment")).json(), { environmentId: "own-copy-id" });
  for (const [route, init] of [["/api/bots?messages=0"], ["/api/config"], ["/api/move/freeze", { method: "POST" }], ["/api/move/freeze", { method: "DELETE" }], ["/api/move/forget", { method: "POST" }], ["/api/workspace-backup/upload", { method: "POST" }]]) {
    await assert.rejects(request(route, init), { code: "clean-workspace" }, `${init?.method ?? "GET"} ${route}`);
  }
  assert.deepEqual(w.requests, [], "nothing reached the clean workspace's server");
});

test("what must reach the frozen copy brings its server back first, and nothing opens the clean workspace until it's done", async (t) => {
  const w = computer(t);
  await w.clean.enter();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const lift = w.clean.holding(async () => {
    assert.equal(w.running, w.dataDir, "its own server, before the work");
    assert.equal(await w.clean.enter(), false, "the window asking meanwhile gets no clean workspace");
    assert.equal(w.running, w.dataDir);
    await held;
    return "lifted";
  });
  release();
  assert.equal(await lift, "lifted");
  assert.equal(await w.clean.enter(), true, "afterwards it opens again if it's still wanted");
  w.swapFails = true;
  await assert.rejects(w.clean.holding(async () => assert.fail("never on the clean workspace")), /could not go back/u);
});
