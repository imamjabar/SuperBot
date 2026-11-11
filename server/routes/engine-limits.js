import { engineLimitsFor } from "../engine-limits.js";
import { planAccountsFromInstances } from "../plan-usage.js";
import { PASS } from "./table.js";
const LIMITS = "/api/internal/engine-limits";
export function createEngineLimitsRoutes(deps) {
    return async (ctx) => {
        if (ctx.method !== "GET" || ctx.path !== LIMITS)
            return PASS;
        const configs = deps.configs();
        const report = await deps.load(planAccountsFromInstances(configs)).catch(() => null);
        const accounts = engineLimitsFor({ instances: deps.instances(), configs, status: deps.status, report, turn: "team", dataDir: deps.dataDir });
        return void ctx.json(ctx.res, 200, { text: JSON.stringify({ accounts }) });
    };
}
