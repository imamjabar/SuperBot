import { createHash } from "node:crypto";
import { DATA_DIR } from "./config.js";
import { appendDecision } from "./decision-log.js";
import { json } from "./harness/http.js";
import { skillReferencesSha256 } from "./skill-storage.js";
import { applyStagedSkillWrite, getStagedSkillWrite, rejectStagedSkillWrite } from "./skills.js";
export function resolveSkillRequest(store, args) {
    const message = store.messagesFor(args.threadId).find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.skillRequest);
    const card = message?.card;
    const request = card?.skillRequest;
    if (!request || !card || !message)
        return { claimed: false };
    if (request.botId !== args.botId) {
        return { claimed: true, status: 403, error: "this skill request belongs to a different bot" };
    }
    if (card.answered || card.dismissed) {
        const cleanup = rejectStagedSkillWrite(args.botId, request.stagedId);
        if ("applied" in cleanup && cleanup.applied && card.answered !== "allow") {
            store.patchMessage(args.threadId, message.id, {
                card: { ...card, answered: "allow", dismissed: false, held: undefined },
            });
            return { claimed: true, outcome: "allowed-once", alreadySettled: true };
        }
        return { claimed: true, outcome: card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true };
    }
    if (args.behavior !== "allow") {
        const rejected = rejectStagedSkillWrite(args.botId, request.stagedId);
        if ("error" in rejected && rejected.error !== "no such staged skill") {
            return { claimed: true, status: 409, error: rejected.error };
        }
        if ("applied" in rejected) {
            store.patchMessage(args.threadId, message.id, {
                card: { ...card, answered: "allow", dismissed: false, held: undefined },
            });
            appendDecision(DATA_DIR, {
                threadId: args.threadId,
                requestId: args.requestId,
                botId: args.botId,
                botName: args.botName,
                tool: card.tool,
                summary: card.subtitle,
                decision: "user-approved",
                source: "user",
            });
            return { claimed: true, outcome: "allowed-once" };
        }
        store.patchMessage(args.threadId, message.id, {
            card: { ...card, answered: "deny", dismissed: true, held: undefined },
        });
        appendDecision(DATA_DIR, {
            threadId: args.threadId,
            requestId: args.requestId,
            botId: args.botId,
            botName: args.botName,
            tool: card.tool,
            summary: card.subtitle,
            decision: "user-denied",
            source: "user",
        });
        return { claimed: true, outcome: "rejected" };
    }
    if (typeof request.preview !== "string" || typeof request.sha256 !== "string") {
        return {
            claimed: true,
            status: 409,
            error: "this proposal was created by an older build — deny it and ask the bot to create it again",
        };
    }
    if (args.reviewedSha256 !== request.sha256) {
        return {
            claimed: true,
            status: 409,
            error: "reviewedSha256 must match the skill shown on the approval card",
        };
    }
    const previewSha256 = createHash("sha256").update(request.preview).digest("hex");
    if (previewSha256 !== request.sha256 || skillReferencesSha256(request.references ?? []) !== request.referencesSha256) {
        return { claimed: true, status: 422, error: "the skill preview changed after review — deny and recreate it" };
    }
    const staged = getStagedSkillWrite(args.botId, request.stagedId);
    if (!staged) {
        const replayed = applyStagedSkillWrite(args.botId, request.stagedId, {
            expectedSha256: request.sha256,
            expectedReferencesSha256: request.referencesSha256 ?? null,
        });
        if ("error" in replayed ||
            replayed.name !== request.name ||
            replayed.source !== request.source) {
            return {
                claimed: true,
                status: 422,
                error: "the staged skill no longer matches this approval card",
            };
        }
        const patched = store.patchMessage(args.threadId, message.id, {
            card: { ...card, answered: "allow", held: undefined },
        });
        if (!patched) {
            return { claimed: true, status: 409, error: "the learned-skill approval card is no longer available" };
        }
        appendDecision(DATA_DIR, {
            threadId: args.threadId,
            requestId: args.requestId,
            botId: args.botId,
            botName: args.botName,
            tool: card.tool,
            summary: card.subtitle,
            decision: "user-approved",
            source: "user",
        });
        return { claimed: true, outcome: "allowed-once" };
    }
    if (request.requestId !== args.requestId ||
        request.threadId !== args.threadId ||
        staged.action !== request.action ||
        staged.name !== request.name ||
        staged.source !== request.source ||
        staged.sha256 !== request.sha256 ||
        staged.referencesSha256 !== request.referencesSha256) {
        return { claimed: true, status: 422, error: "the staged skill no longer matches this approval card" };
    }
    const applied = applyStagedSkillWrite(args.botId, request.stagedId, {
        expectedSha256: request.sha256,
        expectedReferencesSha256: request.referencesSha256 ?? null,
        onApplied: () => {
            const patched = store.patchMessage(args.threadId, message.id, {
                card: { ...card, answered: "allow", held: undefined },
            });
            if (!patched)
                throw new Error("the learned-skill approval card is no longer available");
        },
    });
    if ("error" in applied) {
        store.patchMessage(args.threadId, message.id, {
            card: { ...card, held: applied.error },
        });
        return { claimed: true, status: 422, error: applied.error };
    }
    appendDecision(DATA_DIR, {
        threadId: args.threadId,
        requestId: args.requestId,
        botId: args.botId,
        botName: args.botName,
        tool: card.tool,
        summary: card.subtitle,
        decision: "user-approved",
        source: "user",
    });
    return { claimed: true, outcome: "allowed-once" };
}
export function sendSkillResolution(res, result) {
    if (!result.claimed)
        return false;
    if ("error" in result) {
        json(res, result.status, { error: result.error });
        return true;
    }
    json(res, 200, { ok: true, outcome: result.outcome, alreadySettled: result.alreadySettled });
    return true;
}
