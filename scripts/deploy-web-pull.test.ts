import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../deploy/superbot-web-pull.sh", import.meta.url));
const dirs: string[] = [];

const stubs: Record<string, string> = {
  docker: `#!/bin/sh
echo "docker $*" >> "$STUB_STATE/calls"
case " $* " in
  *" ps -q omb "*) cat "$STUB_STATE/omb" 2>/dev/null ;;
  *" ps -q caddy "*) echo caddy-1 ;;
  *" run "*) exit "\${STUB_VALIDATE_RC:-0}" ;;
  *" --force-recreate omb "*)
    [ -n "\${STUB_KEEP_ID:-}" ] && exit 0
    n=$(( $(cat "$STUB_STATE/recreates" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$STUB_STATE/recreates"
    echo "omb-$n" > "$STUB_STATE/omb" ;;
  *" inspect "*) for arg; do last=$arg; done; echo "$last" ;;
esac
exit 0
`,
  curl: `#!/bin/sh
echo "curl $*" >> "$STUB_STATE/calls"
[ -z "\${STUB_HEALTH_FAIL:-}" ] || exit 7
echo '{"app":"superbot"}'
`,
  sleep: `#!/bin/sh
echo "sleep $*" >> "$STUB_STATE/calls"
`,
  timeout: `#!/bin/sh
shift
exec "$@"
`,
};

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "omb-web-pull-"));
  dirs.push(root);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const state = join(root, "state");
  const remote = join(root, "remote.git");
  for (const dir of [join(home, "SuperBot"), bin, state]) mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(state, "omb"), "omb-0\n");
  execFileSync("git", ["init", "-q", "--bare", remote]);

  let commits = 0;
  const publish = (branch: string, files: Record<string, string>) => {
    const work = join(root, `work-${branch}`);
    const git = (...args: string[]) => execFileSync("git", ["-C", work, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { stdio: "ignore" });
    if (!existsSync(work)) {
      mkdirSync(work);
      git("init", "-q");
    }
    for (const [name, content] of Object.entries(files)) writeFileSync(join(work, name), `${content} ${++commits}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", `${branch} ${commits}`);
    git("push", "-q", `file://${remote}`, `HEAD:refs/heads/${branch}`);
  };
  const publishWeb = () => publish("web-dist", { "index.html": "<html>" });
  const publishServer = () => publish("server-dist", { "index.js": "export {};" });

  const run = (env: Record<string, string> = {}) => {
    rmSync(join(state, "calls"), { force: true });
    const result = spawnSync("/bin/sh", [script], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, STUB_STATE: state, SUPERBOT_REPO: `file://${remote}`, ...env },
    });
    const callsFile = join(state, "calls");
    const calls = existsSync(callsFile) ? readFileSync(callsFile, "utf8").trim().split("\n") : [];
    return { ...result, calls };
  };

  publishWeb();
  publishServer();
  return { run, publishWeb, publishServer };
}

const callIndex = (calls: string[], suffix: string) => calls.findIndex((line) => line.startsWith("docker compose") && line.endsWith(suffix));
const ombRecreate = "up -d --no-deps --no-build --force-recreate omb";
const caddyRecreate = "up -d --no-deps --no-build --force-recreate caddy";

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    execFileSync("chmod", ["-R", "u+w", dir]);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform === "win32")("deploy/superbot-web-pull.sh", () => {
  it("force-recreates omb on a new server bundle, then recreates caddy, then checks health", () => {
    const deploy = fixture();
    expect(deploy.run().status).toBe(0);
    deploy.publishServer();

    const result = deploy.run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("omb and caddy are up");
    const validate = result.calls.findIndex((line) => line.includes(" run -T --rm --no-deps"));
    const omb = callIndex(result.calls, ombRecreate);
    const caddy = callIndex(result.calls, caddyRecreate);
    const health = result.calls.findIndex((line) => line.startsWith("curl ") && line.includes("/api/health"));
    expect(validate).toBeGreaterThanOrEqual(0);
    expect(omb).toBeGreaterThan(validate);
    expect(caddy).toBeGreaterThan(omb);
    expect(health).toBeGreaterThan(caddy);
    expect(result.calls.some((line) => line.includes("caddy reload"))).toBe(false);
  });

  it("touches neither omb nor caddy when nothing changed", () => {
    const deploy = fixture();
    expect(deploy.run().status).toBe(0);

    const result = deploy.run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("server-dist unchanged");
    expect(result.calls).toEqual([]);
  });

  it("restarts nothing for a web-only update", () => {
    const deploy = fixture();
    expect(deploy.run().status).toBe(0);
    deploy.publishWeb();

    const result = deploy.run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("web-dist updated");
    expect(result.calls).toEqual([]);
  });

  it("fails without touching caddy when omb keeps its container id", () => {
    const deploy = fixture();
    expect(deploy.run().status).toBe(0);
    deploy.publishServer();

    const result = deploy.run({ STUB_KEEP_ID: "1" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("omb was not recreated");
    expect(result.stdout).not.toContain("omb and caddy are up");
    expect(callIndex(result.calls, caddyRecreate)).toBe(-1);
  });

  it("fails after a bounded number of health checks when the app never answers", () => {
    const deploy = fixture();
    deploy.publishServer();

    const result = deploy.run({ STUB_HEALTH_FAIL: "1" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("health check");
    expect(result.stdout).not.toContain("omb and caddy are up");
    expect(result.calls.filter((line) => line.startsWith("curl ")).length).toBe(20);
  });

  it("restarts nothing when the compiled server fails validation", () => {
    const deploy = fixture();

    const result = deploy.run({ STUB_VALIDATE_RC: "3" });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("Compiled server validation failed 3");
    expect(result.stdout).not.toContain("omb and caddy are up");
    expect(result.calls.some((line) => line.includes(" up "))).toBe(false);
  });
});
