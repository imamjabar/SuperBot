import { viewerTargetId } from "../shared/desktop-viewer.js";
import { desktopViewerUrl } from "./routes/desktop-viewer.js";
/** Native owner windows keep the existing direct viewer and cookie isolation; seats other than 1 have only the proxy. */
export function localVmViewerStatus(status, auth, seat) {
    const extraSeat = seat !== undefined && seat > 1;
    return auth.kind === "loopback" && !extraSeat ? status : {
        ...status,
        viewer_url: status.viewer_url ? desktopViewerUrl(viewerTargetId({ key: status.target_key, seat })) : "",
    };
}
function unavailable(reason) {
    return Object.assign(new Error(`Local VM unavailable: ${reason}`), { status: 409 });
}
function statusProblem(status, needsRuntime) {
    if (!status.managed)
        return "container is not managed";
    if (!status.imageMatches)
        return "image does not match";
    if (status.network !== "loopback")
        return `network is ${status.network}`;
    if (status.container !== "running")
        return `container is ${status.container}`;
    if (!status.viewer_url)
        return "container publishes no viewer port";
    if (needsRuntime && !status.runtime)
        return "no container runtime";
    return null;
}
/** `tunnel`: set when this server runs in a container of its own, whose loopback is not the host's, so the desktop's
 * loopback-published viewer port is reached through `exec -i` instead. */
export function localDesktopTarget(target, deps) {
    return {
        key: target.key,
        async resolve() {
            const status = await deps.status(target);
            const problem = statusProblem(status, Boolean(deps.tunnel));
            if (problem)
                throw unavailable(problem);
            const { tunnel } = deps;
            const runtime = status.runtime;
            return {
                port: tunnel ? 0 : status.viewer_port ?? 0,
                ...(tunnel && runtime ? { connect: () => tunnel(runtime, target.containerName) } : {}),
                password: new URLSearchParams(new URL(status.viewer_url).hash.slice(1)).get("password"),
                touch: () => deps.touch(target),
            };
        },
    };
}
/** One extra seat of the shared container. Its websockify is reached through a tunnel, and only while the seat runs. */
export function seatDesktopTarget(target, deps) {
    return {
        key: viewerTargetId(target),
        async resolve() {
            const status = await deps.status(target);
            const problem = statusProblem(status, true);
            if (problem)
                throw unavailable(problem);
            const runtime = status.runtime;
            const seat = await deps.seatStatus(runtime, target.seat);
            if (!seat.running) {
                const down = Object.entries(seat.programs).filter(([, state]) => state !== "RUNNING").map(([name, state]) => `${name} ${state}`);
                throw unavailable(`seat ${target.seat} is not running (${[...down, ...(seat.socketReady ? [] : ["no Cua socket"])].join(", ")})`);
            }
            const fragment = new URLSearchParams(new URL(status.viewer_url).hash.slice(1));
            return {
                port: 0,
                connect: () => deps.tunnel(runtime, target.seat),
                password: fragment.get("password"),
                viewPassword: fragment.get("view_password"),
                touch: () => deps.touch(target),
            };
        },
    };
}
export function sharedDesktopSeat(id) {
    if (id === "local/shared")
        return 1;
    const seat = /^local\/shared-seat-([23])$/.exec(id);
    return seat ? Number(seat[1]) : null;
}
