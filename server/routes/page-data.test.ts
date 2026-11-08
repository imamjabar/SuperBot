import { describe, expect, it } from "vitest";

import { embeddedPageData, postingDataUrl } from "./page-data.ts";

describe("embeddedPageData", () => {
  it("extracts JSON-LD JobPosting with compensation and tag-free description", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "datePosted": "2026-07-31",
            "description": "<p>Build <strong>AI systems</strong> &amp; infra.</p>",
            "baseSalary": {
              "@type": "MonetaryAmount",
              "currency": "USD",
              "value": {
                "@type": "QuantitativeValue",
                "minValue": 180000,
                "maxValue": 225000,
                "unitText": "YEAR"
              }
            }
          }
          </script>
        </head>
        <body><div id="root"></div></body>
      </html>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("Structured data:");
    expect(result).toContain("datePosted: 2026-07-31");
    expect(result).toContain("minValue: 180000");
    expect(result).toContain("maxValue: 225000");
    expect(result).toContain("unitText: YEAR");
    expect(result).toContain("description: Build AI systems & infra.");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<strong>");
  });

  it("extracts Ashby-style window.__appData with nested braces and strings containing braces", () => {
    const html = `
      <html>
        <head>
          <script>
            window.__appData = {"posting":{"title":"Applied AI Engineer","compensationTierSummary":"$180K – $225K","note":"test } inside"}};
          </script>
        </head>
        <body></body>
      </html>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("Page data:");
    expect(result).toContain("posting.title: Applied AI Engineer");
    expect(result).toContain("posting.compensationTierSummary: $180K – $225K");
    expect(result).toContain("posting.note: test } inside");
  });

  it("returns empty string on invalid JSON in script or assignment", () => {
    const html = `
      <script type="application/ld+json">{ not real json }</script>
      <script>window.__appData = { invalid: syntax };</script>
    `;
    expect(embeddedPageData(html)).toBe("");
  });

  it("emits duplicate string values only once", () => {
    const html = `
      <script type="application/ld+json">
      {
        "shortSummary": "Build amazing tools.",
        "fullSummary": "Build amazing tools."
      }
      </script>
    `;
    const result = embeddedPageData(html);
    const matches = result.match(/Build amazing tools\./g);
    expect(matches).toHaveLength(1);
  });

  it("drops noise keys such as id and logoUrl", () => {
    const html = `
      <script type="application/ld+json">
      {
        "id": "job-12345",
        "logoUrl": "https://example.com/logo.png",
        "title": "Systems Architect"
      }
      </script>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("title: Systems Architect");
    expect(result).not.toContain("job-12345");
    expect(result).not.toContain("logo.png");
  });

  it("keeps url when parent object has title or name, but drops standalone url", () => {
    const html = `
      <script type="application/ld+json">
      {
        "company": {
          "name": "Acme Corp",
          "url": "https://example.com/acme"
        },
        "meta": {
          "url": "https://example.com/meta"
        }
      }
      </script>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("company.url: https://example.com/acme");
    expect(result).not.toContain("https://example.com/meta");
  });

  it("truncates values longer than 20,000 characters", () => {
    const longString = "word ".repeat(5000);
    const html = `
      <script type="application/ld+json">
      {
        "longField": "${longString}"
      }
      </script>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("longField: " + "word ".repeat(5000).trim().slice(0, 20000) + "…");
  });

  it("keeps at most the last 6 segments for deeply nested paths", () => {
    const html = `
      <script type="application/ld+json">
      {
        "a": { "b": { "c": { "d": { "e": { "f": { "g": "deep" } } } } } }
      }
      </script>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("b.c.d.e.f.g: deep");
    expect(result).not.toContain("a.b.c.d.e.f.g");
  });

  it("decodes escaped HTML description into plain text", () => {
    const html = `
      <script type="application/ld+json">
      {
        "description": "&lt;p&gt;We are looking for a &lt;strong&gt;Senior Engineer&lt;/strong&gt; to join.&lt;/p&gt;"
      }
      </script>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("description: We are looking for a Senior Engineer to join.");
    expect(result).not.toContain("&lt;");
    expect(result).not.toContain("<p>");
  });

  it("drops token-like strings and long JSON-looking strings", () => {
    const token = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const longJson = JSON.stringify({ longData: "x".repeat(250) });
    const html = `
      <script type="application/ld+json">
      {
        "title": "Staff Engineer",
        "sessionToken": "${token}",
        "rawPayload": ${JSON.stringify(longJson)}
      }
      </script>
    `;
    const result = embeddedPageData(html);
    expect(result).toContain("title: Staff Engineer");
    expect(result).not.toContain(token);
    expect(result).not.toContain("rawPayload");
  });

  it("appState:false keeps JSON-LD but drops __NEXT_DATA__", () => {
    const html = `
      <script type="application/ld+json">
      {
        "title": "Principal Architect"
      }
      </script>
      <script id="__NEXT_DATA__" type="application/json">
      {
        "props": { "pageProps": { "company": "Acme Global" } }
      }
      </script>
    `;
    const withoutApp = embeddedPageData(html, { appState: false });
    expect(withoutApp).toContain("Structured data:");
    expect(withoutApp).toContain("title: Principal Architect");
    expect(withoutApp).not.toContain("Page data:");
    expect(withoutApp).not.toContain("Acme Global");

    const withApp = embeddedPageData(html, { appState: true });
    expect(withApp).toContain("Structured data:");
    expect(withApp).toContain("title: Principal Architect");
    expect(withApp).toContain("Page data:");
    expect(withApp).toContain("Acme Global");
  });

  it("maps Greenhouse job URLs to boards-api URLs and returns undefined for other hosts or paths", () => {
    expect(postingDataUrl(new URL("https://job-boards.greenhouse.io/artefact/jobs/8829736002"))).toBe(
      "https://boards-api.greenhouse.io/v1/boards/artefact/jobs/8829736002?pay_transparency=true",
    );
    expect(postingDataUrl(new URL("https://boards.greenhouse.io/artefact/jobs/8829736002"))).toBe(
      "https://boards-api.greenhouse.io/v1/boards/artefact/jobs/8829736002?pay_transparency=true",
    );
    expect(postingDataUrl(new URL("https://job-boards.greenhouse.io/artefact/jobs/8829736002/"))).toBe(
      "https://boards-api.greenhouse.io/v1/boards/artefact/jobs/8829736002?pay_transparency=true",
    );
    expect(postingDataUrl(new URL("https://other-boards.greenhouse.io/artefact/jobs/8829736002"))).toBeUndefined();
    expect(postingDataUrl(new URL("https://job-boards.greenhouse.io/artefact/departments"))).toBeUndefined();
    expect(postingDataUrl(new URL("https://example.com/artefact/jobs/8829736002"))).toBeUndefined();
  });
});
