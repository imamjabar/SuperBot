const RECALL_POOL_FACTOR = 4;
const RECALL_POOL_MAX = 80;
const RRF_K = 20;
const RECENCY_WEIGHT = 0.5;
const COVERAGE_WEIGHT = 0.05;

/** How many bm25 hits to read for `limit` ranked ones. */
export function recallPoolSize(limit: number): number {
  return Math.max(limit, Math.min(RECALL_POOL_MAX, limit * RECALL_POOL_FACTOR));
}

interface RecallCandidate { at: number; kind: string; head: string; snippet: string }

/** Lexical rank and recency fused by reciprocal rank, plus a bonus for each query term the hit actually carries, so
 * a hit naming every term outranks one repeating a single term, and of two equal matches the newer comes first. A
 * digest still follows every message. `rows` arrive in bm25 order. */
export function rankRecall<Row extends RecallCandidate>(rows: readonly Row[], terms: readonly string[], limit: number): Row[] {
  const byRecency = [...rows].sort((a, b) => b.at - a.at);
  const recencyRank = new Map(byRecency.map((row, index) => [row, index]));
  const score = new Map(rows.map((row, index) => {
    const text = `${row.head} ${row.snippet}`.toLowerCase();
    const covered = terms.filter((term) => text.includes(term)).length;
    return [row, 1 / (RRF_K + index) + RECENCY_WEIGHT / (RRF_K + recencyRank.get(row)!) + COVERAGE_WEIGHT * covered];
  }));
  return [...rows]
    .sort((a, b) => Number(a.kind === "digest") - Number(b.kind === "digest") || score.get(b)! - score.get(a)! || b.at - a.at)
    .slice(0, limit);
}
