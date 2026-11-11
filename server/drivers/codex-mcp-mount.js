import { tomlInlineTable } from "./codex-process.js";
export function mountMcpServer(appServerArgs, env, name, server, approval = "auto", 
/** Written into the mount's own `env` table: its process gets them, Codex's command shell does not. */
literalEnv = {}, written = new Set()) {
    const prefix = `mcp_servers.${name}`;
    Object.assign(env, server.env);
    for (const name of Object.keys(server.env))
        written.add(name);
    appServerArgs.push("-c", `${prefix}.command=${JSON.stringify(server.command)}`, "-c", `${prefix}.args=${JSON.stringify(server.args)}`, 
    // argv carries names only, so credentials never appear in process listings.
    "-c", `${prefix}.env_vars=${JSON.stringify(Object.keys(server.env))}`);
    if (Object.keys(literalEnv).length)
        appServerArgs.push("-c", `${prefix}.env=${tomlInlineTable(literalEnv)}`);
    if (approval !== "prompt")
        appServerArgs.push("-c", `${prefix}.default_tools_approval_mode="${approval}"`);
}
