import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SKILL_TOOLS_GUEST, skillToolsDockerfile } from "./skill-vm-tools.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-vm-tools-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function write(root: string, path: string, content: string | Buffer) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

describe("skillToolsDockerfile", () => {
  it("puts every skill's vm files on the desktop byte for byte, scripts executable", () => {
    const root = temp();
    const script = "#!/usr/bin/env python3\nprint('it\\'s \"quoted\" $HOME `x`')\n";
    write(root, "decks/vm/check_deck.py", script);
    write(root, "decks/vm/lib/theme.json", "{\"accent\": \"#123\"}");
    write(root, "decks/SKILL.md", "---\nname: decks\n---\n");
    write(root, "notes/SKILL.md", "---\nname: notes\n---\n");
    const step = skillToolsDockerfile(root);
    expect(step.startsWith("RUN ")).toBe(true);
    const out = temp();
    execFileSync("sh", ["-c", step.slice(4).replaceAll(SKILL_TOOLS_GUEST, out)]);
    expect(readFileSync(join(out, "decks/check_deck.py"), "utf8")).toBe(script);
    expect(readFileSync(join(out, "decks/lib/theme.json"), "utf8")).toBe("{\"accent\": \"#123\"}");
    expect(statSync(join(out, "decks/check_deck.py")).mode & 0o777).toBe(0o755);
    expect(statSync(join(out, "decks/lib/theme.json")).mode & 0o777).toBe(0o644);
    expect(() => statSync(join(out, "notes"))).toThrow();
  });

  it("adds no step when no skill has vm files, and refuses a path or size a step cannot carry", () => {
    const root = temp();
    write(root, "notes/SKILL.md", "---\nname: notes\n---\n");
    expect(skillToolsDockerfile(root)).toBe("");
    expect(skillToolsDockerfile(join(root, "missing"))).toBe("");
    write(root, "bad/vm/it's.py", "x");
    expect(() => skillToolsDockerfile(root)).toThrow(/characters/);
    rmSync(join(root, "bad"), { recursive: true });
    write(root, "big/vm/blob.bin", Buffer.alloc(64 * 1024 + 1));
    expect(() => skillToolsDockerfile(root)).toThrow(/over/);
  });
});
