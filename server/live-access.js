export const LIVE_AZURE_REFUSAL = "Live calls here go through Azure OpenAI, so only an admin or the owner of this server can start one. Ask an admin if you need a call.";
/** Null only for an admin or the single owner. A caller this does not recognise is refused. */
export function azureLiveCallRefusal(auth, place) {
    if (!auth.scopes.includes("admin"))
        return LIVE_AZURE_REFUSAL;
    if (auth.kind === "session")
        return auth.session.teamRole === "member" || auth.session.moveIn ? LIVE_AZURE_REFUSAL : null;
    if (auth.kind === "loopback")
        return auth.trust === "service" || place.othersOnLoopback ? LIVE_AZURE_REFUSAL : null;
    return LIVE_AZURE_REFUSAL;
}
/** The words for a session without the admin scope, which never reaches a Live route. Only the words: the request is refused either way. */
export function liveScopeRefusal(cfg, method, path) {
    return cfg.live?.provider === "azure" && method.toUpperCase() === "POST" && path === "/api/live/session" ? LIVE_AZURE_REFUSAL : null;
}
