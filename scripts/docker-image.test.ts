import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

// The published images: the self-hosted server (the default target) and the
// Cloud home. A pull downloads every layer whose digest changed, and a layer's
// digest changes when anything beneath it does.
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const dockerYmlPath = new URL("../.github/workflows/docker.yml", import.meta.url);
const workflow = existsSync(dockerYmlPath) ? parse(readFileSync(dockerYmlPath, "utf8")) : null;

interface Step { op: string; args: string }
interface Stage { name: string; from: string; platform?: string; steps: Step[] }

function stages(text: string): Stage[] {
  const all: Stage[] = [];
  let pending = "";
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || (!pending && !line.trim())) continue;
    pending += line.endsWith("\\") ? `${line.slice(0, -1)} ` : line;
    if (line.endsWith("\\")) continue;
    const [, op, args] = /^\s*(\S+)\s*([\s\S]*)$/.exec(pending)!;
    pending = "";
    if (op.toUpperCase() === "FROM") {
      const [, platform, from, name] = /^(?:--platform=(\S+)\s+)?(\S+)(?:\s+AS\s+(\S+))?$/i.exec(args.trim())!;
      all.push({ name: name ?? `#${all.length}`, from, platform, steps: [] });
    } else all.at(-1)?.steps.push({ op: op.toUpperCase(), args: args.trim() });
  }
  return all;
}

const all = stages(dockerfile);
/** Every instruction a target's image is built from, its parents' first. */
function chain(target: string): Step[] {
  const stage = all.find(s => s.name === target);
  if (!stage) throw new Error(`the Dockerfile has no ${target} stage`);
  return [...(all.some(s => s.name === stage.from) ? chain(stage.from) : []), ...stage.steps];
}
const shipped = () => all.filter(s => s.name !== "build" && s.name !== "edge").flatMap(s => s.steps);
const npmInstall = (step: Step) => step.op === "RUN" && /\bnpm install\b/.test(step.args);
const browserRun = () => chain("runtime").find(step => step.op === "RUN" && step.args.includes("agent-browser install"))!;
// The keys step parses Chrome for Testing's JSON with jq, as on GitHub's runners.
const jq = process.platform === "win32" ? "" : spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("container images", () => {
  it("keeps the self-hosted server the target of the file", () => {
    expect(all.at(-1)!.name).toBe("server");
    expect(all.find(s => s.name === "server")!.from).toBe("runtime");
    // the build arg docker-compose.yml passes keeps its name and empty default
    expect(chain("server")).toContainEqual({ op: "ARG", args: 'ENGINES=""' });
  });

  it("puts the browser and the engines beneath the per-commit app files, so a code change leaves them as they were", () => {
    for (const target of ["server"]) {
      const steps = chain(target);
      const heavy = steps.flatMap((step, i) => (npmInstall(step) ? [i] : []));
      const app = steps.flatMap((step, i) => (step.op === "COPY" && !step.args.includes("--from=edge") ? [i] : []));
      // agent-browser + Chrome, then (Cloud home only) pnpm in the tools layer, then the engines, then the app files
      // (and the Cloud home's Caddyfile)
      expect(heavy, target).toHaveLength(2);
      const fromBuild = steps.flatMap((step, i) => (step.op === "COPY" && step.args.includes("--from=build") ? [i] : []));
      expect(fromBuild, target).toHaveLength(4);
      expect(Math.max(...heavy), target).toBeLessThan(Math.min(...app));
      // The Data engine's native tree (DuckDB, resvg) changes on a version bump,
      // not per commit, so it is copied before the per-commit app files.
      const native = steps.findIndex(step => step.op === "COPY" && step.args.includes("/dist-native/duckdb/"));
      expect(native, target).toBeGreaterThan(-1);
      expect(native, target).toBeLessThan(Math.min(...fromBuild.filter(i => i !== native)));
    }
  });

  it("leaves no npm or compile cache in a layer: each install removes its own in the same step", () => {
    const installs = shipped().filter(npmInstall);
    expect(installs.length).toBeGreaterThanOrEqual(2);
    for (const { args } of installs) {
      const cache = /--cache (\S+)/.exec(args)?.[1] ?? /\bHOME=(\S+) npm install\b/.exec(args)?.[1];
      expect(cache, args).toMatch(/^\/tmp\//);
      // Every `rm -rf` in the step counts: the Cloud home's tools layer clears apt's lists before its pnpm install.
      const removed = [...args.matchAll(/\brm -rf ([^;&|]+)/g)].flatMap((match) => match[1]!.trim().split(/\s+/));
      expect(removed, args).toEqual(expect.arrayContaining([cache, "/tmp/node-compile-cache"]));
    }
  });

  it("ships the app files once, root's without a rewrite", () => {
    for (const { args } of shipped()) expect(args).not.toMatch(/\bch(own|mod) -R\b/);
    // modes are fixed where the files are built, in a stage that is not shipped
    const build = all.find(s => s.name === "build")!.steps.find(step => step.op === "RUN" && step.args.startsWith("pnpm build:server"))!;
    expect(build.args).toMatch(/ && chmod -R go-w dist dist-server skills$/);
    expect(chain("server").filter(step => step.args.includes("--from=build")).every(step => step.args.startsWith("--from=build --chown=maus:maus "))).toBe(true);
  });


  it.skipIf(!workflow)("scans the saved images for every throwaway build directory, and for one Grok", () => {
    const scan = (workflow.jobs["build-and-smoke"].steps as { name?: string; run?: string }[])
      .find(step => step.name?.startsWith("Prove each image ships its files once"))!.run!;
    const cache = new RegExp(/cache = re\.compile\(r"(.*)"\)/.exec(scan)![1]);
    const removed = shipped().flatMap(step => [...step.args.matchAll(/\brm -rf ([^;&|]+)/g)].flatMap(match => match[1].trim().split(/\s+/)));
    const throwaway = [...new Set(removed.filter(path => path.startsWith("/tmp/")))].sort();
    expect(throwaway).toEqual(["/tmp/grok-install", "/tmp/node-compile-cache", "/tmp/npm-cache", "/tmp/omb-build-home", "/tmp/uv-install"]);
    for (const path of throwaway) expect(cache.test(`${path.slice(1)}/leftover`), path).toBe(true);
    expect(scan).toContain('grok = files["usr/local/bin/grok"]');
  });

  it("keeps each image's runtime contract", () => {
    const last = (steps: Step[], op: string) => steps.filter(step => step.op === op).at(-1)?.args;
    const server = chain("server");
    expect(last(server, "USER")).toBe("maus");
    expect(last(server, "VOLUME")).toBe('["/data"]');
    expect(last(server, "CMD")).toBe('["node", "dist-server/server-launcher.js"]');
    expect(last(server, "HEALTHCHECK")).toContain("http://127.0.0.1:8799/api/health");
    expect(last(chain("runtime"), "ENV")).toMatch(/^AGENT_BROWSER_EXECUTABLE_PATH=\/opt\/openmausbot-browser\/chrome .*NODE_ENV=production$/);
  });


  it("never runs a build step with HOME on the volume, so nothing lands in what a fresh volume starts with", () => {
    for (const target of ["server"]) {
      const steps = chain(target);
      const home = steps.findIndex(step => step.op === "ENV" && /(^|\s)HOME=\/data\b/.test(step.args));
      expect(home, target).toBeGreaterThan(-1);
      expect(steps.slice(home).filter(step => step.op === "RUN"), target).toEqual([]);
    }
  });

  it.skipIf(process.platform === "win32")("keeps only agent-browser's native binary, and refuses when the command is not one", () => {
    const { args } = browserRun();
    const start = args.indexOf("native=");
    const end = args.indexOf("&& agent-browser --version", start);
    expect(start).toBeGreaterThan(args.indexOf("agent-browser install"));
    expect(end).toBeGreaterThan(start);
    const prune = args.slice(start, end);
    const run = (target: string, elf = true) => {
      const root = mkdtempSync(join(tmpdir(), "omb-agent-browser-"));
      temporaryDirectories.push(root);
      const bin = join(root, "lib/node_modules/agent-browser/bin");
      mkdirSync(bin, { recursive: true });
      mkdirSync(join(root, "bin"));
      const names = ["agent-browser-darwin-arm64", "agent-browser-linux-arm64", "agent-browser-linux-musl-x64", "agent-browser-linux-x64", "agent-browser-win32-x64.exe", "agent-browser.js"];
      for (const name of names) writeFileSync(join(bin, name), name === "agent-browser-linux-x64" && elf ? "\x7fELF\x02\x01" : "#!/usr/bin/env node\n", { mode: 0o755 });
      symlinkSync(join(bin, target), join(root, "bin/agent-browser"));
      const result = spawnSync("sh", ["-c", prune], { env: { PATH: `${join(root, "bin")}:/usr/bin:/bin` }, encoding: "utf8" });
      return { status: result.status, left: readdirSync(bin).sort(), names };
    };
    expect(run("agent-browser-linux-x64")).toMatchObject({ status: 0, left: ["agent-browser-linux-x64", "agent-browser.js"] });
    // npm linking the JS wrapper instead must stop the build, not delete every native binary
    const wrapper = run("agent-browser.js");
    expect(wrapper.status).not.toBe(0);
    expect(wrapper.left).toEqual(wrapper.names);
    const script = run("agent-browser-linux-x64", false);
    expect(script.status).not.toBe(0);
    expect(script.left).toEqual(script.names);
  });

  it("builds the server image for linux/arm64 too: the DuckDB tree and the browser follow the image's CPU", () => {
    // The JavaScript build runs once on the build host; only the native tree is per CPU, staged after it.
    const build = all.find(s => s.name === "build")!;
    expect(build.platform).toBe("$BUILDPLATFORM");
    const declared = build.steps.findIndex(step => step.op === "ARG" && step.args === "TARGETARCH");
    expect(declared).toBeGreaterThan(build.steps.findIndex(step => step.op === "RUN" && step.args.startsWith("pnpm build:server")));
    const stage = build.steps.find(step => step.op === "RUN" && step.args.includes("prepare-duckdb.mjs"))!;
    expect(build.steps.indexOf(stage)).toBeGreaterThan(declared);
    if (process.platform !== "win32") {
      for (const [targetArch, arch] of [["amd64", "x64"], ["arm64", "arm64"], ["", "x64"]]) {
        const root = mkdtempSync(join(tmpdir(), "omb-duckdb-arch-"));
        temporaryDirectories.push(root);
        mkdirSync(join(root, "scripts"));
        // A stand-in for the staging script: it stages the CPU it is told to, and records which.
        writeFileSync(join(root, "scripts/prepare-duckdb.mjs"), 'import { mkdirSync, writeFileSync } from "node:fs"; const d = `dist-native/duckdb/linux-${process.env.OMB_DUCKDB_ARCH}`; mkdirSync(d, { recursive: true }); writeFileSync(`${d}/arch`, process.env.OMB_DUCKDB_ARCH);');
        const result = spawnSync("sh", ["-c", stage.args], { cwd: root, env: { PATH: process.env.PATH, TARGETARCH: targetArch }, encoding: "utf8" });
        expect(result.status, `${targetArch}: ${result.stderr}`).toBe(0);
        expect(readdirSync(join(root, "dist-native/duckdb")), targetArch).toEqual(["target"]);
        expect(readFileSync(join(root, "dist-native/duckdb/target/arch"), "utf8"), targetArch).toBe(arch);
      }
    }
    // Chrome for Testing has no Linux ARM64 build: an arm64 image takes Debian's Chromium at the same path.
    const runtime = chain("runtime");
    expect(runtime.slice(0, runtime.indexOf(browserRun()))).toContainEqual({ op: "ARG", args: "TARGETARCH" });
    expect(browserRun().args).toMatch(/if \[ "\$TARGETARCH" = arm64 \]; then .*apt-get install -y --no-install-recommends chromium .*ln -s \/usr\/lib\/chromium\/chromium \/opt\/openmausbot-browser\/chrome; +else .*agent-browser install .*; +fi/);
    if (!workflow) return;
    const steps = workflow.jobs.publish.steps as { id?: string; uses?: string; with?: Record<string, string> }[];
    const server = steps.findIndex(step => step.uses?.startsWith("docker/build-push-action@") && step.id !== "home");
    const qemu = steps.findIndex(step => step.uses?.startsWith("docker/setup-qemu-action@"));
    expect(qemu).toBeGreaterThan(-1);
    expect(qemu).toBeLessThan(server);
    expect(steps[server].with!.platforms).toBe("linux/amd64,linux/arm64");
    expect(steps.find(step => step.id === "home")!.with).not.toHaveProperty("platforms");
    // and an arm64 runner proves the arm64 image boots, serves and browses before anything is published
    const arm = workflow.jobs["arm64-smoke"];
    expect(arm["runs-on"]).toBe("ubuntu-24.04-arm");
    expect(workflow.jobs.publish.needs).toEqual(expect.arrayContaining(["build-and-smoke", "arm64-smoke"]));
    const armRun = (arm.steps as { run?: string }[]).map(step => step.run ?? "").join("\n");
    expect(armRun).toContain("/api/health");
    expect(armRun).toContain("agent-browser --session ci-browser open");
  });


  it("keys the browser and engine layers on the versions they install, so a release rebuilds them", () => {
    const runtime = all.find(s => s.name === "runtime")!.steps;
    const declared = runtime.findIndex(step => step.op === "ARG" && step.args.startsWith("CHROME_CACHE_TAG="));
    // declared after the apt step, so a Chrome release rebuilds only the browser layer
    expect(declared).toBeGreaterThan(runtime.findIndex(step => step.op === "RUN" && step.args.startsWith("apt-get update")));
    expect(declared).toBeLessThan(runtime.indexOf(browserRun()));
    expect(browserRun().args).toContain("${CHROME_CACHE_TAG");
    expect(runtime.findIndex(step => step.op === "ARG" && step.args.startsWith("CHROMIUM_CACHE_TAG="))).toBeLessThan(runtime.indexOf(browserRun()));
    expect(browserRun().args).toContain("${CHROMIUM_CACHE_TAG");
    // engines baked on demand
  });

  it.skipIf(!jq || !workflow)("resolves the current Chrome and engine releases, and keys on the date when a lookup fails", () => {
    const keys = (workflow.jobs.publish.steps as { id?: string; run?: string; env?: Record<string, string> }[]).find(step => step.id === "keys")!;
    const resolve = (ok: boolean) => {
      const root = mkdtempSync(join(tmpdir(), "omb-docker-keys-"));
      temporaryDirectories.push(root);
      const fake = (name: string, body: string) => writeFileSync(join(root, name), `#!/bin/sh\n${ok ? body : "exit 1"}\n`, { mode: 0o755 });
      fake("curl", `case "$*" in *madison*) printf ' chromium | 150.0.7871.100-1~deb12u1 | bookworm          | arm64\\n chromium | 156.0.8078.73-1~deb12u1  | bookworm-security | arm64\\n';; *) echo '{"channels":{"Stable":{"version":"154.0.8037.92","downloads":{}}}}';; esac`);
      fake("npm", `case "$2" in @anthropic-ai/claude-code@latest) echo 2.1.291;; @openai/codex@latest) echo 0.160.1;; *) exit 1;; esac`);
      const output = join(root, "output");
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-e", "-c", keys.run!], {
        env: { ...keys.env, PATH: `${root}:${dirname(jq)}:/usr/bin:/bin`, GITHUB_OUTPUT: output }, encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    };
    expect(resolve(true)).toEqual({
      chrome: "154.0.8037.92",
      chromium: "156.0.8078.73-1~deb12u1",
      engines: "@anthropic-ai/claude-code@2.1.291 @openai/codex@0.160.1",
      engines_tag: "",
    });
    const today = `date-${new Date().toISOString().slice(0, 10)}`;
    expect(resolve(false)).toEqual({ chrome: today, chromium: today, engines: "@anthropic-ai/claude-code @openai/codex", engines_tag: today });
  });

  // An init collects browser processes whose parents exit, and Chrome gets the
  // shared memory OpenMausBot's desktop containers give it.
  it("runs every compose service of the server image with an init and Chrome's shared memory", () => {
    for (const file of ["../compose.yaml", "../deploy/docker-compose.yml", "../deploy/podman/compose.yaml"]) {
      const service = parse(readFileSync(new URL(file, import.meta.url), "utf8")).services.omb;
      expect(service.init, file).toBe(true);
      expect(service.shm_size, file).toBe("512m");
    }
  });

  it("forwards the public HTTPS scheme to the app even when Caddy itself is reached over plain HTTP", () => {
    const caddy = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
    const app = caddy.match(/reverse_proxy 127\.0\.0\.1:8799 \{[^}]*\}/)?.[0] ?? "";
    const hooks = caddy.match(/handle \/hooks\/\* \{[^}]*\}/)?.[0] ?? "";
    expect(app).toMatch(/^\s*header_up X-Forwarded-Proto https$/m);
    expect(hooks).toContain("reverse_proxy 127.0.0.1:8800");
    expect(hooks).not.toContain("header_up");
    expect(caddy).not.toMatch(/trusted_proxies|header_up X-Forwarded-For|header_up Origin/);
  });
});

describe.skipIf(process.platform === "win32")("superbot-web-pull.sh", () => {
  const OLD = "a".repeat(64);
  const NEW = "b".repeat(64);
  /** Runs the updater against stub git, docker and curl; `replaces` makes `up omb` start a new container. */
  function update({ serverChanged = true, replaces = false, caddyIn = OLD, health = '{"app":"openmausbot"}' }: { serverChanged?: boolean; replaces?: boolean; caddyIn?: string; health?: string } = {}) {
    const home = mkdtempSync(join(tmpdir(), "omb-web-pull-"));
    temporaryDirectories.push(home);
    const bin = join(home, "bin");
    const log = join(home, "calls.log");
    const state = join(home, "omb.id");
    mkdirSync(bin);
    mkdirSync(join(home, "SuperBot", "server-dist"), { recursive: true });
    writeFileSync(join(home, "SuperBot", "server-dist", "index.js"), "");
    // cloud-home-start.js dropped with Cloud home removal
    writeFileSync(state, OLD);
    const stub = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
    stub("git", [
      'case "$*" in',
      '  *"rev-parse FETCH_HEAD"*) echo new ;;',
      `  *"--verify HEAD"*) case "$*" in *server-dist*) echo ${serverChanged ? "old" : "new"} ;; *) echo new ;; esac ;;`,
      "esac",
    ].join("\n"));
    stub("docker", [
      'case "$*" in',
      `  *"up -d --no-deps --no-build omb"*) ${replaces ? `echo ${NEW} > "${state}"` : ":"} ;;`,
      `  *"ps -q omb"*) cut -c1-12 "${state}" ;;`,
      "  *\"ps -q caddy\"*) echo caddy0000000 ;;",
      `  *"{{.Id}}"*) cat "${state}" ;;`,
      `  *"{{.HostConfig.NetworkMode}}"*) echo "container:${caddyIn}" ;;`,
      "esac",
    ].join("\n"));
    stub("curl", `echo '${health}'`);
    stub("timeout", 'shift; exec "$@"');
    const run = spawnSync("sh", [new URL("../deploy/superbot-web-pull.sh", import.meta.url).pathname], {
      encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home },
    });
    spawnSync("chmod", ["-R", "u+w", home]);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    return { status: run.status, stderr: run.stderr, calls, docker: calls.filter(call => call.startsWith("docker ")) };
  }
  const recreated = (docker: string[]) => docker.filter(call => call.includes("--force-recreate caddy"));
  const reloaded = (docker: string[]) => docker.filter(call => call.includes("caddy reload"));

  it("never touches omb or caddy when the server bundle did not change", () => {
    const { status, docker } = update({ serverChanged: false });
    expect(status).toBe(0);
    expect(docker).toEqual([]);
  });

  it("keeps the same omb container's caddy and only reloads its config", () => {
    const { status, stderr, docker } = update();
    expect(status, stderr).toBe(0);
    expect(docker.filter(call => call.includes(" up "))).toEqual([expect.stringContaining("up -d --no-deps --no-build omb")]);
    expect(reloaded(docker)).toHaveLength(1);
    expect(recreated(docker)).toEqual([]);
  });

  it("reattaches caddy exactly once when omb was replaced", () => {
    const { status, stderr, docker } = update({ replaces: true });
    expect(status, stderr).toBe(0);
    expect(recreated(docker)).toEqual([expect.stringContaining("up -d --no-deps --no-build --force-recreate caddy")]);
    expect(reloaded(docker)).toEqual([]);
  });

  it("reattaches a caddy left in another namespace even when omb kept its id", () => {
    const { status, docker } = update({ caddyIn: "c".repeat(64) });
    expect(status).toBe(0);
    expect(recreated(docker)).toHaveLength(1);
  });

  it("fails when the health check does not answer as the app", () => {
    const { status, stderr } = update({ health: "<html>502</html>" });
    expect(status).toBe(1);
    expect(stderr).toContain("does not answer its health check");
  });
});
