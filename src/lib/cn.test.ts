import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("keeps a type-scale size next to a text colour", () => {
    expect(cn("text-caption", "text-ink-secondary")).toBe("text-caption text-ink-secondary");
    expect(cn("text-body-sm text-danger")).toBe("text-body-sm text-danger");
  });

  it("lets a later type-scale size replace an earlier one", () => {
    expect(cn("text-small", "text-caption")).toBe("text-caption");
    expect(cn("text-[13px]", "text-micro")).toBe("text-micro");
  });
});
