import { saveConfig, syncCredentialEnv } from "./config.js";
import { azureLiveEndpoint, LIVE_NEEDS_AZURE, LIVE_NEEDS_KEY, openAiLiveEndpoint } from "./live-call.js";
import { liveSavePatch, usableLiveKey } from "./live-config.js";
export const LIVE_IDLE_MINUTES_DEFAULT = 5;
/** A saved Live key goes only to the provider and host it was saved for (`usableLiveKey`), and the OpenAI API key only ever to OpenAI. */
export function liveCallKey(cfg) {
    const live = usableLiveKey(cfg.live);
    if (live)
        return { key: live, source: "live" };
    if (cfg.live?.provider === "azure")
        return null;
    const openai = cfg.openai?.key?.trim();
    return openai ? { key: openai, source: "openai" } : null;
}
/** null when Azure is chosen but its endpoint or deployment is missing or not valid. */
export function liveCallEndpoint(cfg, env = process.env) {
    return cfg.live?.provider === "azure"
        ? azureLiveEndpoint(cfg.live.azureEndpoint, cfg.live.azureDeployment)
        : openAiLiveEndpoint(env);
}
export function liveSetupProblem(cfg) {
    const azure = cfg.live?.provider === "azure";
    if (!liveCallKey(cfg))
        return azure ? LIVE_NEEDS_AZURE : LIVE_NEEDS_KEY;
    return liveCallEndpoint(cfg) ? null : LIVE_NEEDS_AZURE;
}
/** The environment follows the save, as for PUT /api/config: loadConfig prefers it over the file. */
export function saveLiveSettings(cfg, patch) {
    const live = liveSavePatch(cfg.live, patch);
    saveConfig({ live });
    syncCredentialEnv({ live });
}
/** What a call start reads, once: its key, endpoint and provider all come from this one reading. */
export function liveCallSettings(cfg) {
    return { key: liveCallKey(cfg)?.key ?? "", endpoint: liveCallEndpoint(cfg), setupProblem: liveSetupProblem(cfg), ...liveSettingsFor(cfg) };
}
/** A caller without the admin scope learns which service calls use, not which Azure resource. */
export function liveSettingsForClient({ azureEndpoint: _endpoint, azureDeployment: _deployment, ...settings }) {
    return settings;
}
export function liveSettingsFor(cfg) {
    const minutes = cfg.live?.idleMinutes;
    const key = liveCallKey(cfg);
    const azure = cfg.live?.provider === "azure";
    return {
        configured: liveSetupProblem(cfg) === null,
        ...(key ? { keySource: key.source } : {}),
        ...(azure ? { provider: "azure" } : {}),
        ...(cfg.live?.azureEndpoint ? { azureEndpoint: cfg.live.azureEndpoint } : {}),
        ...(cfg.live?.azureDeployment ? { azureDeployment: cfg.live.azureDeployment } : {}),
        voice: cfg.live?.voice ?? "",
        readTypedReplies: cfg.live?.readTypedReplies ?? true,
        idleMinutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= 60 ? minutes : LIVE_IDLE_MINUTES_DEFAULT,
    };
}
