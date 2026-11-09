import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";
import { SKILL_TOOLS_GUEST, skillToolsDockerfile } from "./skill-vm-tools.ts";

const skillsDir = join(process.cwd(), "skills");
const skills = loadBundledSkills(skillsDir);
const WORK_SKILLS = ["presentations", "motion-video", "data-analysis"];

describe("work skills", () => {
  const activate = (prompt: string, capabilities: string[] = ["worker"]) =>
    selectBundledSkills(prompt, capabilities, skills).map((skill) => skill.manifest.id).filter((id) => WORK_SKILLS.includes(id));

  it("mount on a working turn for English and Indonesian asks", () => {
    for (const [prompt, id] of [
      ["Please create a pitch deck for our board meeting", "presentations"],
      ["Buatkan ppt untuk presentasi produk baru", "presentations"],
      ["Make a 30s promo video with kinetic text", "motion-video"],
      ["Buatkan animasi reel pendek dalam format mp4", "motion-video"],
      ["Run a regression on this csv file", "data-analysis"],
      ["Tolong analisis statistik spreadsheet ini", "data-analysis"],
    ] as const) {
      expect(activate(prompt), prompt).toContain(id);
    }
  });

  it("stay out of the front desk, which has no computer to run them", () => {
    expect(activate("Buatkan ppt dan video animasi dari analisis csv ini", [])).toEqual([]);
  });

  it("put every helper script on the desktop byte for byte", () => {
    const out = mkdtempSync(join(tmpdir(), "work-skills-"));
    try {
      execFileSync("sh", ["-c", skillToolsDockerfile(skillsDir).slice(4).replaceAll(SKILL_TOOLS_GUEST, out)]);
      for (const id of WORK_SKILLS) {
        const helpers = readdirSync(join(skillsDir, id, "vm"));
        expect(helpers.length, id).toBeGreaterThan(0);
        for (const name of helpers) expect(readFileSync(join(out, id, name)), `${id}/${name}`).toEqual(readFileSync(join(skillsDir, id, "vm", name)));
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
