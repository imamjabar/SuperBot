/** A ```chart block in a reply: `label: value` lines, after optional `title:`, `unit:` and `type:` lines. */
export interface AnswerChart {
  title?: string;
  unit?: string;
  kind: "bar" | "line";
  points: { label: string; value: number; shown: string }[];
}

export interface AnswerFact {
  label: string;
  value: string;
}

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const PAIR = /^\s*(?:[-*+]\s+)?([^:|]+?)\s*[:|]\s*(.*?)\s*\|?\s*$/;
const NUMBER = /[-−]?\d[\d.,]*/;
const HEADERS = new Set(["title", "unit", "type"]);

function pairs(code: string): [string, string][] {
  return code.split(/\r?\n/).flatMap((line) => {
    const match = PAIR.exec(line);
    return match && match[1] && match[2] ? [[match[1].replace(/\*\*/g, "").trim(), match[2].replace(/\*\*/g, "").trim()]] : [];
  });
}

/** The first number in the value: "4.59", "$1,234", "Rp 150.000", "1.234,5" and "12%" all read. A lone separator
 * before exactly three digits groups thousands ("150.000"), unless the whole part is 0 ("0.125"). */
export function chartNumber(text: string): number | null {
  const raw = NUMBER.exec(text)?.[0].replace("−", "-").replace(/[.,]+$/, "");
  if (!raw) return null;
  const digits = raw.replace(/^-/, "");
  const separators = new Set(digits.match(/[.,]/g) ?? []);
  let decimal: string | null = null;
  if (separators.size === 2) decimal = digits.lastIndexOf(",") > digits.lastIndexOf(".") ? "," : ".";
  else if (separators.size === 1 && digits.split(/[.,]/).length === 2) {
    const [whole, fraction] = digits.split(/[.,]/) as [string, string];
    decimal = fraction.length === 3 && whole !== "0" ? null : [...separators][0]!;
  }
  const grouped = decimal ? digits.replaceAll(decimal === "," ? "." : ",", "").replace(decimal, ".") : digits.replace(/[.,]/g, "");
  const value = Number(grouped) * (raw.startsWith("-") ? -1 : 1);
  return Number.isFinite(value) ? value : null;
}

export function parseAnswerChart(code: string): AnswerChart {
  const chart: AnswerChart = { kind: "bar", points: [] };
  for (const [label, value] of pairs(code)) {
    const key = label.toLowerCase();
    if (chart.points.length === 0 && HEADERS.has(key)) {
      if (key === "title") chart.title = value;
      else if (key === "unit") chart.unit = value;
      else chart.kind = /line|trend/i.test(value) ? "line" : "bar";
      continue;
    }
    const number = chartNumber(value);
    if (number !== null) chart.points.push({ label, value: number, shown: value });
  }
  return chart;
}

export function parseAnswerFacts(code: string): AnswerFact[] {
  return pairs(code).map(([label, value]) => ({ label, value }));
}

const CALLOUT_MARK = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n)?/i;

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: { hProperties?: Record<string, unknown> } };

/** GitHub's `> [!TIP]` alerts: the quote keeps its text and says which kind it is as `data-callout`. */
export function remarkCallouts() {
  const visit = (node: MdNode) => {
    for (const child of node.children ?? []) {
      if (child.type === "blockquote") markCallout(child);
      visit(child);
    }
  };
  return (tree: MdNode) => visit(tree);
}

function markCallout(quote: MdNode) {
  const paragraph = quote.children?.[0];
  const text = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;
  const match = text?.type === "text" ? CALLOUT_MARK.exec(text.value ?? "") : null;
  if (!paragraph || !text || !match) return;
  text.value = text.value!.slice(match[0].length);
  if (!text.value) paragraph.children!.shift();
  if (paragraph.children![0]?.type === "break") paragraph.children!.shift();
  if (!paragraph.children!.length) quote.children!.shift();
  quote.data = { ...quote.data, hProperties: { ...quote.data?.hProperties, dataCallout: match[1]!.toLowerCase() } };
}
