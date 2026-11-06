import type { Duplex } from "node:stream";
import { viewerTargetId } from "../shared/desktop-viewer.ts";
import type { ContainerComputerStatus, LocalVmTarget, Runtime } from "./container-computer.ts";
import type { RequestAuth } from "./request-auth.ts";
import { desktopViewerUrl, type DesktopTarget } from "./routes/desktop-viewer.ts";

/** Native owner windows keep the existing direct viewer and cookie isolation; seats other than 1 have only the proxy. */
export function localVmViewerStatus<T extends { target_key: string; viewer_url: string }>(status: T, auth: RequestAuth, seat?: number): T {
  const extraSeat = seat !== undefined && seat > 1;
  return auth.kind === "loopback" && !extraSeat ? status : {
    ...status,
    viewer_url: status.viewer_url ? desktopViewerUrl(viewerTargetId({ key: status.target_key, seat })) : "",
  };
}

export function localDesktopTarget(target: LocalVmTarget, deps: {
  status: (target: LocalVmTarget) => Promise<ContainerComputerStatus>;
  touch: (target: LocalVmTarget) => void;
}): DesktopTarget {
  return {
    key: target.key,
    async resolve() {
      const status = await deps.status(target);
      if (!status.managed || !status.imageMatches || status.network !== "loopback" || status.container !== "running"
        || !status.viewer_url) {
        throw Object.assign(new Error("Local VM unavailable"), { status: 409 });
      }
      return {
        port: status.viewer_port ?? 0,
        password: new URLSearchParams(new URL(status.viewer_url).hash.slice(1)).get("password"),
        touch: () => deps.touch(target),
      };
    },
  };
}

/** One extra seat of the shared container. Its websockify is reached through a tunnel, and only while the seat runs. */
export function seatDesktopTarget(target: LocalVmTarget & { seat: number }, deps: {
  status: (target: LocalVmTarget) => Promise<ContainerComputerStatus>;
  seatRunning: (runtime: Runtime, seat: number) => Promise<boolean>;
  tunnel: (runtime: Runtime, seat: number) => Duplex;
  touch: (target: LocalVmTarget) => void;
}): DesktopTarget {
  return {
    key: viewerTargetId(target),
    async resolve() {
      const status = await deps.status(target);
      if (!status.managed || !status.imageMatches || status.network !== "loopback" || status.container !== "running"
        || !status.viewer_url || !status.runtime) {
        throw Object.assign(new Error("Local VM unavailable"), { status: 409 });
      }
      const runtime = status.runtime;
      if (!(await deps.seatRunning(runtime, target.seat))) {
        throw Object.assign(new Error("Local VM seat is not running"), { status: 409 });
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
