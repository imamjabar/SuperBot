import { describe, expect, it } from "vitest";
import { normalizePagesOrigin, readPagesConfig } from "./config.ts";

describe("the pages address", () => {
  it("takes an https origin or a loopback http one, and drops a trailing slash", () => {
    expect(normalizePagesOrigin("https://superbot.taile267f1.ts.net:8443")).toBe("https://superbot.taile267f1.ts.net:8443");
    expect(normalizePagesOrigin("https://pages.example.com/")).toBe("https://pages.example.com");
    expect(normalizePagesOrigin("  https://Pages.Example.com  ")).toBe("https://pages.example.com");
    expect(normalizePagesOrigin("http://127.0.0.1:8801")).toBe("http://127.0.0.1:8801");
    expect(normalizePagesOrigin("http://localhost:8801/")).toBe("http://localhost:8801");
  });

  it("refuses anything but an origin", () => {
    for (const bad of ["http://pages.example.com", "ftp://pages.example.com", "https://user:pw@pages.example.com", "https://pages.example.com/pages",
      "https://pages.example.com/?x=1", "https://pages.example.com/#top", "https://pages.example.com?", "pages.example.com", "", "https://"]) {
      expect(normalizePagesOrigin(bad), bad).toBeNull();
    }
  });
});

describe("the pages configuration", () => {
  it("defaults the port to the app's plus two and leaves publishing off without an address", () => {
    const warnings: string[] = [];
    expect(readPagesConfig({}, 8799, (line) => warnings.push(line))).toEqual({ port: 8801 });
    expect(readPagesConfig({ OMB_PAGES_PORT: "9100", OMB_PAGES_PUBLIC_URL: "https://pages.example.com/" }, 8799, (line) => warnings.push(line)))
      .toEqual({ port: 9100, publicUrl: "https://pages.example.com" });
    expect(warnings).toEqual([]);
  });

  it("treats an invalid address as unset and warns once", () => {
    const warnings: string[] = [];
    expect(readPagesConfig({ OMB_PAGES_PUBLIC_URL: "https://pages.example.com/p" }, 8799, (line) => warnings.push(line))).toEqual({ port: 8801 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("OMB_PAGES_PUBLIC_URL");
  });
});
