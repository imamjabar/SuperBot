// The step list and the new-element marks follow browser-use's ultrafast mode (one model call chains the actions
// it already knows; `*` marks ids new since the last look): browser-use/browser-use@693ddd2 browser_use/ax.py,
// MIT License, Copyright (c) 2024 Gregor Zunic. Rewritten for SuperBot's agent_browser tools.
import { z } from "zod";
import { REFS_GONE } from "../browser-tool-shape.js";
export const STEPS_TOOL = "agent_browser_steps";
export const MAX_STEPS = 8;
/** No step starts after this much of the list's time; each step still keeps its own call budget. */
export const STEPS_BUDGET_MS = 90_000;
const STEP_TOOLS = new Set(["click", "fill", "type", "press", "select", "check", "uncheck", "hover", "scroll", "drag", "wait", "wait_for_text", "wait_for_selector", "wait_for_load", "wait_ms"]
    .map((name) => `agent_browser_${name}`));
const SNAPSHOT_TOOL = "agent_browser_snapshot";
const OPEN_TOOL = "agent_browser_open";
/** Calls after which the tab in front shows another page, or none. */
const PAGE_SWITCHES = new Set(["navigate", "back", "forward", "reload", "tabs", "tab_new", "tab_switch", "tab_close", "close"].map((name) => `agent_browser_${name}`).concat("restart_browser"));
export const STEPS_TOOL_SPEC = {
    name: STEPS_TOOL,
    description: `Run up to ${MAX_STEPS} page actions in order in one call, then answer with the page's snapshot. Use it when you already know the next actions, such as filling a form's fields and pressing its button. Each step is one of click, fill, type, press, select, check, uncheck, hover, scroll, drag or a wait, with the arguments that tool takes. The list stops at the first step that fails, and before a step that uses a ref once an earlier step moved to another page.`,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            steps: {
                type: "array",
                minItems: 1,
                maxItems: MAX_STEPS,
                items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        tool: { type: "string", description: "The action, such as click or agent_browser_fill." },
                        arguments: { type: "object", description: "The arguments that action's own tool takes, such as { \"ref\": \"e12\" }." },
                    },
                    required: ["tool"],
                },
            },
            snapshot: { type: "boolean", description: "Answer with the page's snapshot after the steps. Defaults to true." },
        },
        required: ["steps"],
    },
};
const ToolResult = z.looseObject({
    content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).catch([]),
    isError: z.boolean().optional().catch(undefined),
});
export function toolNameOf(params) {
    const name = params?.name;
    return typeof name === "string" ? name : undefined;
}
const StepsCall = z.object({ arguments: z.object({
        steps: z.array(z.object({ tool: z.string().trim(), arguments: z.record(z.string(), z.unknown()).optional() }).strict()).min(1).max(MAX_STEPS),
        snapshot: z.boolean().optional(),
    }).strict() });
const resultOf = (value) => ToolResult.catch({ content: [] }).parse(value);
const textOf = (result) => result.content.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n");
const refusal = (text) => ({ isError: true, content: [{ type: "text", text }] });
function parseSteps(params) {
    const parsed = StepsCall.safeParse(params);
    if (!parsed.success)
        return `${STEPS_TOOL} needs steps: a list of one to ${MAX_STEPS} actions, each { tool, arguments }. ${parsed.error.issues[0]?.message ?? ""}`.trim();
    const steps = [];
    for (const [index, step] of parsed.data.arguments.steps.entries()) {
        const tool = step.tool.startsWith("agent_browser_") ? step.tool : `agent_browser_${step.tool}`;
        if (!STEP_TOOLS.has(tool))
            return `Step ${index + 1} is ${JSON.stringify(step.tool)}; a step is one of click, fill, type, press, select, check, uncheck, hover, scroll, drag or a wait. Open pages, read and take screenshots with their own tools.`;
        steps.push({ tool, args: step.arguments ?? {} });
    }
    return { steps, snapshot: parsed.data.arguments.snapshot !== false };
}
const usesRef = (args) => Object.entries(args).some(([key, value]) => key === "ref" || (typeof value === "object" && value !== null && !Array.isArray(value) && usesRef(value)));
/** Runs the steps of an agent_browser_steps call's params, each as its own browser call, so every per-call guard, lane and record applies to it. */
export async function runSteps(params, call, now = Date.now) {
    const plan = parseSteps(params);
    if (typeof plan === "string")
        return refusal(plan);
    const { steps } = plan;
    const started = now();
    const lines = [];
    for (const [index, step] of steps.entries()) {
        const label = `${index + 1}. ${step.tool.replace(/^agent_browser_/u, "")}`;
        if (index > 0 && now() - started >= STEPS_BUDGET_MS) {
            lines.push(`Steps ${index + 1} to ${steps.length} did not run: the list ran out of time. Check the page, then go on.`);
            break;
        }
        const result = resultOf(await call(step.tool, step.args));
        const text = textOf(result);
        lines.push(`${label}: ${text || "done."}`);
        if (result.isError) {
            if (index + 1 < steps.length)
                lines.push(`Step ${index + 1} failed, so steps ${index + 2} to ${steps.length} did not run.`);
            return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
        }
        const rest = steps.slice(index + 1);
        if (text.includes(REFS_GONE) && rest.some((later) => usesRef(later.args))) {
            lines.push(`Step ${index + 1} moved to another page, so steps ${index + 2} to ${steps.length} did not run: their refs belonged to the page before.`);
            break;
        }
    }
    if (!plan.snapshot)
        return { content: [{ type: "text", text: lines.join("\n") }] };
    const snapshot = resultOf(await call(SNAPSHOT_TOOL, {}));
    return {
        ...(snapshot.isError ? { isError: true } : {}),
        content: [{ type: "text", text: `${lines.join("\n")}\nThe page after the steps:` }, ...snapshot.content],
    };
}
const MARKED_LINE = /^\s*- ([^\s"[]+)(?: "((?:[^"\\]|\\.)*)")?.*\[ref=e\d+\]/u;
const NEW_MARK = " [new]";
function signatures(text) {
    const counts = new Map();
    for (const line of text.split("\n")) {
        const match = MARKED_LINE.exec(line);
        if (match)
            counts.set(`${match[1]} ${match[2] ?? ""}`, (counts.get(`${match[1]} ${match[2] ?? ""}`) ?? 0) + 1);
    }
    return counts;
}
/** Per browser session, the elements of the last snapshot, so the next snapshot of the same page marks what appeared. */
export class NewElementMarks {
    #seen = new Map();
    /** A tool's result, with its snapshot marked when it is a later look at the page the session showed before. */
    after(session, tool, result) {
        if (tool === STEPS_TOOL)
            return result;
        if (tool && PAGE_SWITCHES.has(tool)) {
            this.#seen.delete(session);
            return result;
        }
        if (tool !== OPEN_TOOL && tool !== SNAPSHOT_TOOL)
            return result;
        const parsed = ToolResult.safeParse(result);
        if (!parsed.success || parsed.data.isError)
            return result;
        const now = signatures(textOf(parsed.data));
        const before = this.#seen.get(session);
        this.#seen.set(session, now);
        if (tool === OPEN_TOOL)
            return result;
        if (!before || before.size === 0)
            return result;
        let kept = 0;
        for (const [signature, count] of before)
            kept += Math.min(count, now.get(signature) ?? 0);
        const previous = [...before.values()].reduce((sum, count) => sum + count, 0);
        if (kept * 2 < previous)
            return result;
        return { ...parsed.data, content: parsed.data.content.map((part) => (part.type === "text" && typeof part.text === "string" ? { ...part, text: markNew(part.text, before) } : part)) };
    }
}
function markNew(text, before) {
    const left = new Map(before);
    return text.split("\n").map((line) => {
        const match = MARKED_LINE.exec(line);
        if (!match)
            return line;
        const signature = `${match[1]} ${match[2] ?? ""}`;
        const count = left.get(signature) ?? 0;
        if (count > 0) {
            left.set(signature, count - 1);
            return line;
        }
        return line.replace(/\[ref=(e\d+)\]/u, `[ref=$1]${NEW_MARK}`);
    }).join("\n");
}
