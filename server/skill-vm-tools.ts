import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SKILL_TOOLS_GUEST = "/opt/superbot/skills";

const SAFE_PATH = /^[\w.-]+(\/[\w.-]+)*$/;
const FILE_MAX_BYTES = 64 * 1024;

function filesUnder(directory: string): string[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** A Dockerfile step writing each bundled skill's `vm/` files to `SKILL_TOOLS_GUEST/<skill>/`, so the scripts a skill names
 * are on the desktop; empty when no skill has any. Base64 keeps file contents out of shell quoting. */
export function skillToolsDockerfile(root = process.env.OMB_SKILLS_DIR || join(process.cwd(), "skills")): string {
  if (!existsSync(root)) return "";
  const steps: string[] = [];
  for (const skill of readdirSync(root).sort()) {
    const tools = join(root, skill, "vm");
    if (!existsSync(tools) || !statSync(tools).isDirectory()) continue;
    for (const file of filesUnder(tools)) {
      const path = `${skill}/${relative(tools, file).split(sep).join("/")}`;
      if (!SAFE_PATH.test(path)) throw new Error(`skill tool path ${path} has characters a Dockerfile step cannot carry`);
      const bytes = readFileSync(file);
      if (bytes.length > FILE_MAX_BYTES) throw new Error(`skill tool ${path} is over ${FILE_MAX_BYTES} bytes`);
      const target = `${SKILL_TOOLS_GUEST}/${path}`;
      const mode = /\.(py|sh)$/.test(path) ? "0755" : "0644";
      steps.push(`    install -d -m 0755 "$(dirname '${target}')"; echo '${bytes.toString("base64")}' | base64 -d > '${target}'; chmod ${mode} '${target}'; \\`);
    }
  }
  return steps.length ? `RUN set -eu; \\\n${steps.join("\n")}\n    true\n` : "";
}
