import { parsePushSubscription } from "../web-push.js";
import { PASS } from "./table.js";
/** `push` is null where push is off (a Team Cloud): the key answers null and subscribing is refused. */
export function createWebPushRoutes(push) {
    return async ({ req, res, path, method, json, readBody }) => {
        if (path === "/api/push/key" && method === "GET")
            return json(res, 200, { publicKey: push?.publicKey() ?? null });
        if (path !== "/api/push/subscriptions")
            return PASS;
        if (method !== "POST" && method !== "DELETE")
            return PASS;
        if (!push)
            return json(res, 404, { error: "Push notifications are off here." });
        const body = await readBody(req, 8192);
        if (method === "DELETE") {
            if (typeof body?.endpoint === "string")
                push.unsubscribe(body.endpoint);
            return json(res, 200, { ok: true });
        }
        const subscription = parsePushSubscription(body);
        if (!subscription)
            return json(res, 400, { error: "Not a browser push subscription." });
        push.subscribe(subscription);
        return json(res, 200, { ok: true });
    };
}
