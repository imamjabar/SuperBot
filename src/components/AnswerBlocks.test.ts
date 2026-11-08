import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ChatMarkdown } from "./ChatMarkdown";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

beforeAll(() => setLocale("en"));

describe("answer blocks in a reply", () => {
  it("draws a chart fence as bars scaled to the largest value", () => {
    const html = render("```chart\ntitle: Price\nHetzner: $4.59\nVultr: $20\n```");
    expect(html).toContain('data-answer-chart="bar"');
    expect(html).toContain("scaleX(1)");
    expect(html).toContain(`scaleX(${4.59 / 20})`);
    expect(html).toContain("$4.59");
    expect(html).not.toContain("<pre");
  });

  it("leaves a chart fence with nothing to draw as code", () => {
    expect(render("```chart\njust words\n```")).toContain("<pre");
  });

  it("draws a facts fence as a label and value list", () => {
    const html = render("```facts\nPlan: CX22\nRegion: Ashburn\n```");
    expect(html).toMatch(/<dt[^>]*>Plan<\/dt><dd[^>]*>CX22<\/dd>/);
  });

  it("turns a GitHub alert into a note without its marker, and leaves a plain quote alone", () => {
    const html = render("> [!WARNING]\n> Backups are off.\n\n> just a quote");
    expect(html).toMatch(/role="note"[^>]*data-callout="warning"/);
    expect(html).toContain("Backups are off.");
    expect(html).not.toContain("[!WARNING]");
    expect(html).toMatch(/<blockquote[^>]*>[\s\S]*just a quote/);
  });
});
