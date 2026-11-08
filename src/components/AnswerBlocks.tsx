import { useMemo, type ReactNode } from "react";
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { parseAnswerChart, parseAnswerFacts, type AnswerChart as Chart, type CalloutKind } from "@/lib/answer-blocks";

const SURFACE = "my-1 rounded-xl bg-ink/[0.04] px-3.5 py-3";
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, signDisplay: "exceptZero" });

function ChartTitle({ chart }: { chart: Chart }) {
  if (!chart.title && !chart.unit) return null;
  return (
    <figcaption className="mb-2.5 text-small font-semibold text-ink">
      {chart.title}
      {chart.unit && <span className="font-normal text-ink-tertiary">{chart.title ? " · " : ""}{chart.unit}</span>}
    </figcaption>
  );
}

function Bars({ chart }: { chart: Chart }) {
  const top = Math.max(...chart.points.map((point) => Math.abs(point.value)), 0) || 1;
  return (
    <ul className="grid grid-cols-[minmax(0,max-content)_minmax(3rem,1fr)_max-content] items-center gap-x-3 gap-y-2 text-small">
      {chart.points.map((point, index) => (
        <li key={`${index}:${point.label}`} className="contents">
          <span className="max-w-[9rem] truncate text-ink-secondary" title={point.label}>{point.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden="true">
            <span
              className={cn("block h-full origin-left rounded-full transition-transform duration-300 ease-out rtl:origin-right", Math.abs(point.value) === top ? "bg-accent" : "bg-accent/55")}
              style={{ transform: `scaleX(${Math.abs(point.value) / top})` }}
            />
          </span>
          <span className="text-end font-medium tabular-nums text-ink">{point.shown}</span>
        </li>
      ))}
    </ul>
  );
}

function Trend({ chart }: { chart: Chart }) {
  const values = chart.points.map((point) => point.value);
  const low = Math.min(...values), high = Math.max(...values);
  const span = high - low || 1;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  const line = values.map((value, index) => `${(index * step).toFixed(2)},${(36 - ((value - low) / span) * 32).toFixed(2)}`).join(" ");
  const first = chart.points[0]!, last = chart.points.at(-1)!;
  const change = first.value ? ((last.value - first.value) / Math.abs(first.value)) * 100 : null;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-body font-semibold tabular-nums text-ink">{last.shown}</span>
        {change !== null && values.length > 1 && (
          <span className={cn("text-caption font-medium tabular-nums", change >= 0 ? "text-success" : "text-danger")}>{number.format(change)}%</span>
        )}
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-16 w-full overflow-visible text-accent rtl:-scale-x-100" aria-hidden="true">
        <polygon points={`0,40 ${line} 100,40`} className="fill-current opacity-10" />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-caption text-ink-tertiary">
        <span>{first.label}</span>
        {values.length > 1 && <span>{last.label}</span>}
      </div>
    </div>
  );
}

/** A ```chart block: bars for a comparison, a line for a trend; it grows row by row as the reply streams. */
export function AnswerChartBlock({ code, fallback }: { code: string; fallback: ReactNode }) {
  const chart = useMemo(() => parseAnswerChart(code), [code]);
  if (!chart.points.length && !chart.title) return fallback;
  const label = t("widget.chart.label", { series: chart.title ?? chart.unit ?? "", count: chart.points.length });
  return (
    <figure className={SURFACE} role="group" aria-label={label} data-answer-chart={chart.kind}>
      <ChartTitle chart={chart} />
      {chart.points.length > 0 && (chart.kind === "line" ? <Trend chart={chart} /> : <Bars chart={chart} />)}
    </figure>
  );
}

/** A ```facts block: the key details of one thing, label beside value. */
export function AnswerFactsBlock({ code, fallback }: { code: string; fallback: ReactNode }) {
  const facts = useMemo(() => parseAnswerFacts(code), [code]);
  if (!facts.length) return fallback;
  return (
    <dl className={cn(SURFACE, "grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-small")} data-answer-facts="">
      {facts.map((fact, index) => (
        <div key={`${index}:${fact.label}`} className="contents">
          <dt className="max-w-[10rem] text-ink-tertiary">{fact.label}</dt>
          <dd className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const CALLOUTS: Record<CalloutKind, { icon: LucideIcon; tone: string }> = {
  note: { icon: Info, tone: "bg-accent/[0.08] [&>svg]:text-accent" },
  tip: { icon: Lightbulb, tone: "bg-success/[0.09] [&>svg]:text-success" },
  important: { icon: CircleAlert, tone: "bg-accent/[0.08] [&>svg]:text-accent" },
  warning: { icon: TriangleAlert, tone: "bg-warning/[0.11] [&>svg]:text-warning" },
  caution: { icon: OctagonAlert, tone: "bg-danger/[0.09] [&>svg]:text-danger" },
};

/** GitHub's `> [!TIP]` alert, drawn as a tinted note with its icon. */
export function AnswerCallout({ kind, dir, children }: { kind: CalloutKind; dir?: string; children?: ReactNode }) {
  const { icon: Icon, tone } = CALLOUTS[kind];
  return (
    <div role="note" dir={dir} data-callout={kind} className={cn("my-1 flex gap-2.5 rounded-xl px-3.5 py-2.5 text-ink", tone)}>
      <Icon size={16} className="mt-[3px] shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 [&>*+*]:mt-1.5">{children}</div>
    </div>
  );
}
