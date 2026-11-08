import { describe, expect, it } from "vitest";
import { chartNumber, parseAnswerChart, parseAnswerFacts } from "./answer-blocks";

describe("chartNumber", () => {
  it.each([
    ["4.59", 4.59], ["$1,234", 1234], ["Rp 150.000", 150000], ["1.234,5", 1234.5], ["1,234.5", 1234.5],
    ["0.125", 0.125], ["4,59 €", 4.59], ["12%", 12], ["-3.5", -3.5], ["2.000.000", 2000000], ["20.", 20],
  ])("reads %s as %s", (text, value) => {
    expect(chartNumber(text)).toBe(value);
  });

  it("has no number for text without digits", () => {
    expect(chartNumber("n/a")).toBeNull();
  });
});

describe("parseAnswerChart", () => {
  it("takes headers only before the first point and keeps the value as written", () => {
    expect(parseAnswerChart("title: VPS 2 vCPU\nunit: USD/month\n- Hetzner: $4.59\nVultr | 20 |\nType: 3\nbroken line")).toEqual({
      kind: "bar", title: "VPS 2 vCPU", unit: "USD/month",
      points: [{ label: "Hetzner", value: 4.59, shown: "$4.59" }, { label: "Vultr", value: 20, shown: "20" }, { label: "Type", value: 3, shown: "3" }],
    });
  });

  it("draws a trend as a line and skips rows still streaming in", () => {
    const chart = parseAnswerChart("type: line\nJan: 10\nFeb: 12\nMar:");
    expect(chart.kind).toBe("line");
    expect(chart.points.map((point) => point.label)).toEqual(["Jan", "Feb"]);
  });
});

describe("parseAnswerFacts", () => {
  it("keeps every label and value, bold markers dropped", () => {
    expect(parseAnswerFacts("**Plan**: CX22\nRegion: Ashburn, US\n\nnot a pair")).toEqual([
      { label: "Plan", value: "CX22" }, { label: "Region", value: "Ashburn, US" },
    ]);
  });
});
