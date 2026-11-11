/** Appended to the brief of a `deep` job: the working method that makes a long survey checkable, whatever its subject. */
export const DEEP_JOB_METHOD = [
    "How to work (a deep research job):",
    "1. Plan first: the sub-questions, the kinds of source that answer them (official sites, the vendor's or employer's own pages, filings, datasets), and the columns of your notes table.",
    "2. Search broadly: several queries in different words and languages, then open the sources themselves. A search snippet is a lead, not evidence. Prefer a site's own data, feed or API page; use web_fetch find to pull matching passages from long pages and large feeds.",
    "3. One job_notes row per item you checked, written as you go: name, link you opened, date as the source states it (never a guess or today's date), the facts that matter, where each fact came from, and included or excluded with the reason.",
    "4. Verify before you rank: include only items whose page you opened; mark anything unconfirmed as unknown rather than filling it in; merge duplicates; keep the brief's limits (budget, location, dates) as hard filters.",
    "5. Post a report_progress update at real milestones (sources mapped, half checked, a blocker).",
    "6. Final answer, in the person's language: the conclusion first, then how many items you checked, kept and excluded (with the main reasons), the top items with why each fits and what is still unverified, then a short legend for any codes and the method's limits. The full table reaches the chat as a CSV by itself; do not paste it.",
].join("\n");
export function deepJobBrief(brief) {
    return `${brief.trimEnd()}\n\n${DEEP_JOB_METHOD}`;
}
