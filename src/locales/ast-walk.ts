import { parseSync } from "oxc-parser";

export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export function makeLineAt(text: string): (pos: number) => number {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return (pos: number) => {
    let low = 0, high = lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineStarts[mid]! <= pos) low = mid + 1;
      else high = mid - 1;
    }
    return high + 1;
  };
}

export function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

export function walkChildren(node: unknown, visit: (child: AstNode) => void): void {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = (node as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) visit(item);
      }
    } else if (isAstNode(child)) {
      visit(child);
    }
  }
}

export function attachParents(node: unknown, parent?: unknown): void {
  if (!isAstNode(node)) return;
  node.parent = parent;
  walkChildren(node, (child) => attachParents(child, node));
}

export function parseSource(path: string, text: string): AstNode {
  const lang = path.endsWith(".tsx") ? "tsx" : path.endsWith(".jsx") ? "jsx" : /\.(?:mjs|cjs|js)$/.test(path) ? "js" : "ts";
  const parsed = parseSync(path, text, { lang });
  return parsed.program as unknown as AstNode;
}
