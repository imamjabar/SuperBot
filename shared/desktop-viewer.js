// The names the desktop proxy (`/api/desktop-viewer/<target>`) serves: one rule for the server and the renderer.
/** A Local VM is `local/shared`, `local/shared-seat-<2|3>`, `local/bot-<sha256>` or `local/pool-<seat>`; a bot's VPS is
 * `vps/<botId>`. A `-seat-N` suffix is one extra display inside the shared container. */
export const DESKTOP_VIEWER_TARGET = /^(local\/(?:shared(?:-seat-[23])?|bot-[a-f0-9]{64}|pool-\d+)|vps\/[\w-]+)$/;
/** A Local VM's proxy name, from its target key (`shared`, `bot:<sha256>` or `pool:<seat>`) and its seat; seat 1 has no suffix. */
export const viewerTargetId = (target) => `local/${target.key.replace(":", "-")}${target.seat && target.seat > 1 ? `-seat-${target.seat}` : ""}`;
