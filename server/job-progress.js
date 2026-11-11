import { redactSecretsInText } from "../shared/redact.js";
import { serverLine } from "./server-lines.js";
const CHECK_EVERY_MS = 60_000;
/** Minutes into a job at which the chat gets a one-line "still working" note. */
const NOTE_AT_MINUTES = [2, 5, 10, 20, 30, 45, 60, 90, 120];
const POST_GAP_MS = 60_000;
const POSTS_PER_JOB = 6;
const POST_MAX_CHARS = 600;
const QUIET_AFTER_POST_MS = 3 * 60_000;
/** The chat a bot's own running report-back job reports to. */
function chatOf(coordinator, job) {
    if (job.status !== "running" || !job.parentId || job.groupId || job.reply !== "resume" || job.startedAt === undefined)
        return undefined;
    const parent = coordinator.node(job.parentId);
    if (!parent || parent.botId !== job.botId || parent.groupId || parent.threadId === job.threadId)
        return undefined;
    return parent;
}
/** A bot's own background job keeps the person's chat informed while it runs. */
export function createJobProgress(coordinator, store, now = Date.now) {
    const noted = new Map();
    const posts = new Map();
    const check = () => {
        const live = new Set();
        for (const job of coordinator.all()) {
            const parent = chatOf(coordinator, job);
            if (!parent)
                continue;
            live.add(job.id);
            const minutes = Math.floor((now() - job.startedAt) / 60_000);
            const due = NOTE_AT_MINUTES.filter((mark) => mark <= minutes).at(-1);
            if (due === undefined || (noted.get(job.id) ?? 0) >= due)
                continue;
            noted.set(job.id, due);
            const posted = posts.get(job.id);
            if (posted && now() - posted.at < QUIET_AFTER_POST_MS)
                continue;
            const title = store.taskByThread(job.botId, job.threadId)?.title ?? serverLine(undefined, "server.jobProgress.untitled");
            store.appendMessage(parent.threadId, {
                role: "bot", kind: "activity",
                tool: { name: serverLine(undefined, "server.jobProgress.stillWorking", { title, minutes }), ok: true },
                threadRef: { botId: job.botId, threadId: job.threadId, title },
            });
        }
        for (const id of noted.keys())
            if (!live.has(id))
                noted.delete(id);
        for (const id of posts.keys())
            if (!live.has(id))
                posts.delete(id);
    };
    const post = (botId, jobThreadId, text) => {
        const message = text.trim();
        if (!message)
            return { status: 400, body: { error: "report_progress needs message: one to three sentences for the person." } };
        if (message.length > POST_MAX_CHARS)
            return { status: 400, body: { error: "Keep a progress update under 600 characters." } };
        const job = coordinator.all().find((node) => node.botId === botId && node.threadId === jobThreadId && chatOf(coordinator, node));
        const parent = job && chatOf(coordinator, job);
        if (!job || !parent)
            return { status: 409, body: { error: "Only a running job that reports back to a chat can post progress. Put this in your answer instead." } };
        const posted = posts.get(job.id);
        if (posted && posted.count >= POSTS_PER_JOB)
            return { status: 409, body: { error: "You already posted 6 updates for this job; carry on and put the rest in your final answer." } };
        if (posted && now() - posted.at < POST_GAP_MS)
            return { status: 409, body: { error: "You posted an update less than a minute ago; carry on and post at the next real milestone." } };
        const requestMessageId = store.taskByThread(botId, jobThreadId)?.openedBy?.requestMessageId;
        store.appendMessage(parent.threadId, { role: "bot", kind: "text", text: redactSecretsInText(message), ...(requestMessageId ? { requestMessageId } : {}) });
        store.patchTask(botId, parent.threadId, { unread: true });
        posts.set(job.id, { at: now(), count: (posted?.count ?? 0) + 1 });
        return { status: 200, body: { posted: true } };
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    timer.unref();
    return { check, stop: () => clearInterval(timer), post };
}
