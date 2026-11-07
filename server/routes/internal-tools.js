// The agents tools' internal calls that need only the capability's bot and conversation, its body and its folders: research,
// the helper models' decide and extract, MausBot's notifications and the usage limits. Runs inside index.ts's /api/internal/ block, after the
// capability bearer is checked; each route answers its own paths and passes the rest on.
import { createEngineLimitsRoutes } from "./engine-limits.js";
import { createHelperToolRoutes } from "./helper-tools.js";
import { createMausBotNotificationRoutes } from "./mausbot-notifications.js";
import { PASS } from "./table.js";
import { createWebFetchRoutes } from "./web-fetch.js";
import { createWebSearchRoutes } from "./web-search.js";
import { createXResearchInternalRoutes } from "./x-research.js";
export function createInternalToolRoutes(deps) {
    const routes = [
        createXResearchInternalRoutes(deps.xResearch),
        createHelperToolRoutes(deps.helpers),
        createMausBotNotificationRoutes(deps.notifications),
        createEngineLimitsRoutes(deps.engineLimits),
        createWebFetchRoutes(deps.webFetch),
        createWebSearchRoutes(deps.webSearch),
    ];
    return async (ctx) => {
        for (const route of routes)
            if (await route(ctx) !== PASS)
                return;
        return PASS;
    };
}
