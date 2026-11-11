import { responseGone, sharedComputerRegistration } from "../shared-computers.js";
import { PASS } from "./table.js";
export function createSharedComputerRoutes(deps) {
    return async ({ req, res, path, method, auth, json, readBody }) => {
        if (path !== "/api/shared-computers" && !path.startsWith("/api/shared-computers/"))
            return PASS;
        if (method === "GET" && path === "/api/shared-computers" && deps.enabled()) {
            return json(res, 200, { computers: deps.computers.status(deps.principal(auth)), known: deps.computers.known(deps.principal(auth)) });
        }
        if (method !== "POST" || path === "/api/shared-computers" || !deps.enabled())
            return PASS;
        if (auth.kind !== "session")
            return json(res, 403, { error: "Pair this desktop first" });
        if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? "")))
            return json(res, 415, { error: "JSON required" });
        const body = await readBody(req, 4_000_000);
        if (!deps.enabled())
            return json(res, 404, { error: `no route: ${method} ${path}` });
        if (!deps.sessionLive(auth.session.id))
            return json(res, 401, { error: "Session ended" });
        const secret = String(req.headers["x-omb-computer-secret"] ?? "");
        if (path === "/api/shared-computers/connect") {
            const parsed = sharedComputerRegistration.safeParse(body);
            if (!parsed.success)
                return json(res, 400, { error: "Invalid computer registration" });
            const registration = parsed.data;
            if (registration.environmentId !== deps.environmentId)
                return json(res, 409, { error: "Workspace identity changed. Pair again before sharing this computer." });
            deps.computers.register(registration, { session: auth.session.id, person: deps.personKey(auth.session) }, secret);
            return json(res, 200, { ok: true });
        }
        const route = /^\/api\/shared-computers\/([\w-]+)\/(poll|lease|result|disconnect)$/.exec(path);
        if (!route)
            return json(res, 404, { error: "not found" });
        const [, id, action] = route;
        if (action === "poll") {
            const job = await deps.computers.poll(id, auth.session.id, secret, responseGone(res));
            return json(res, 200, { job });
        }
        if (action === "lease")
            return json(res, 200, { active: deps.computers.liveJob(id, auth.session.id, secret, String(body?.jobId)) });
        if (action === "result")
            deps.computers.complete(id, auth.session.id, secret, String(body?.jobId), body?.result);
        if (action === "disconnect")
            deps.computers.disconnect(id, auth.session.id, secret, body?.paused === true);
        return json(res, 200, { ok: true });
    };
}
