import { describe, expect, it } from "vitest";

import { cleanGithub, sanitizeInput } from "./routine-input.ts";

const BASE_INPUT = {
  name: "Daily Routine",
  prompt: "Check things.",
  botId: "bot-1",
  schedule: { type: "daily" as const, time: "09:00", weekdays: [1, 2, 3, 4, 5] },
};

describe("cleanGithub", () => {
  it("returns undefined when null or undefined", () => {
    expect(cleanGithub(undefined)).toBeUndefined();
    expect(cleanGithub(null)).toBeUndefined();
  });

  it("validates valid repo and branch", () => {
    expect(cleanGithub({ repo: "owner/repo" })).toEqual({ repo: "owner/repo" });
    expect(cleanGithub({ repo: "owner/repo", branch: "main" })).toEqual({ repo: "owner/repo", branch: "main" });
    expect(cleanGithub({ repo: "my-org.co/repo-name_1", branch: "feature/issue-123.v1" })).toEqual({
      repo: "my-org.co/repo-name_1",
      branch: "feature/issue-123.v1",
    });
  });

  it("rejects non-object or invalid repository", () => {
    expect(() => cleanGithub("not-an-object" as never)).toThrow("Choose a GitHub repository like owner/repo");
    expect(() => cleanGithub({ repo: "" })).toThrow("Choose a GitHub repository like owner/repo");
    expect(() => cleanGithub({ repo: "invalid" })).toThrow("Choose a GitHub repository like owner/repo");
    expect(() => cleanGithub({ repo: "too/many/parts" })).toThrow("Choose a GitHub repository like owner/repo");
    expect(() => cleanGithub({ repo: "spaces in / repo" })).toThrow("Choose a GitHub repository like owner/repo");
  });

  it("rejects invalid branch", () => {
    expect(() => cleanGithub({ repo: "owner/repo", branch: "" })).toThrow("Choose a valid GitHub branch");
    expect(() => cleanGithub({ repo: "owner/repo", branch: "bad branch" })).toThrow("Choose a valid GitHub branch");
    expect(() => cleanGithub({ repo: "owner/repo", branch: "x".repeat(101) })).toThrow("Choose a valid GitHub branch");
  });
});

describe("sanitizeInput github validation", () => {
  it("allows github check when valid github repo is given", () => {
    const clean = sanitizeInput({
      ...BASE_INPUT,
      checks: ["github"],
      github: { repo: "owner/repo", branch: "main" },
    }, 0);
    expect(clean.checks).toEqual(["github"]);
    expect(clean.github).toEqual({ repo: "owner/repo", branch: "main" });
  });

  it("requires a github repo when checks includes github", () => {
    expect(() => sanitizeInput({
      ...BASE_INPUT,
      checks: ["github"],
    }, 0)).toThrow("Choose a GitHub repository like owner/repo");

    expect(() => sanitizeInput({
      ...BASE_INPUT,
      checks: ["github"],
      github: null,
    }, 0)).toThrow("Choose a GitHub repository like owner/repo");
  });

  it("rejects unknown checks with updated error text naming github", () => {
    expect(() => sanitizeInput({
      ...BASE_INPUT,
      checks: ["unknown" as never],
    }, 0)).toThrow("Choose checks from calendar, mail, runs and github");
  });

  it("omits github if not given, and keeps it when valid without checks", () => {
    const without = sanitizeInput(BASE_INPUT, 0);
    expect(without.github).toBeUndefined();

    const withGithub = sanitizeInput({
      ...BASE_INPUT,
      github: { repo: "owner/repo" },
    }, 0);
    expect(withGithub.github).toEqual({ repo: "owner/repo" });
  });
});
