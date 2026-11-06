// Cua-backed Local VM: OMB owns only the sandbox boundary; desktop automation is Cua Driver's (`cua-driver mcp` in the container).
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstatSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { augmentedPath, resolveCliSpawn } from "./env-path.ts";
import { workspacePreparationDockerfile } from "./container-workspace.ts";
import { DATA_DIR } from "./config.ts";
import { PIDS_LIMIT, raisePidsLimit } from "./container-limits.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

const run = promisify(execFile);
const SCREENSHOT_STATUS_TTL_MS = 10_000;

export type CommandRunner = (
  command: string,
  args: string[],
  timeout?: number,
) => Promise<{ stdout: string }>;

export const CUA_DRIVER_VERSION = "0.37.0";
export const BASE_IMAGE_REPOSITORY = "docker.io/library/debian";
// Official Debian 13 (trixie) multi-architecture index (amd64 + arm64), verified against registry-1.docker.io.
export const BASE_IMAGE_DIGEST = "sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6";
export const BASE_IMAGE = `${BASE_IMAGE_REPOSITORY}@${BASE_IMAGE_DIGEST}`;
// localhost/ is explicit: Podman prepends it to unqualified build tags and may then resolve the name on Docker Hub.
// Image and container labels, not this mutable tag, decide compatibility.
export const IMAGE_REPOSITORY = "localhost/openmausbot/cua-local-vm";
export const IMAGE_LAYER_VERSION = "9";
export const IMAGE_LAYER_LABEL = "com.openmausbot.image-layer";
const BUILT_IMAGE = `${IMAGE_REPOSITORY}:driver-${CUA_DRIVER_VERSION}-v${IMAGE_LAYER_VERSION}`;
const DIGEST_PINNED_IMAGE = /^[a-z0-9./_-]+(:[\w.-]+)?@sha256:[a-f0-9]{64}$/;
const PREBUILT_IMAGE = process.env.OMB_LOCAL_VM_IMAGE?.trim();
export const IMAGE =
  PREBUILT_IMAGE && DIGEST_PINNED_IMAGE.test(PREBUILT_IMAGE) ? PREBUILT_IMAGE : BUILT_IMAGE;
export const CONTAINER = "openmausbot-computer";
export const MANAGED_LABEL = "com.openmausbot.local-vm";
export const DRIVER_LABEL = "com.openmausbot.cua-driver";
export const BASE_IMAGE_LABEL = "com.openmausbot.cua-base";
export const WORKSPACE_LABEL = "com.openmausbot.workspace";
export const TARGET_LABEL = "com.openmausbot.local-vm-target";
export const VM_WORKSPACE_DIR = join(DATA_DIR, "vm-home");
export const VM_WORKSPACE_GUEST = "/home/cua/workspace";
export const DISPLAY = ":1";
export const CUA_SOCKET = "/run/user/1000/openmausbot-cua.sock";
export const CUA_EXECUTABLE = "/usr/local/libexec/openmausbot/cua-driver";

const RUNTIMES = ["docker", "podman", "container"] as const;
export type Runtime = (typeof RUNTIMES)[number];
export type LifecycleAction = "pull" | "run" | "start" | "stop" | "remove";

const INTERNAL_VIEWER_PORT = 6901;
const HOST_VIEWER_PORT = 6080;
const MEMORY_BYTES = 4 * 1024 * 1024 * 1024;

export interface LocalVmTarget {
  key: string;
  containerName: string;
  workspaceDir: string;
  viewerPort: number | null;
  label: string;
}

export const SHARED_LOCAL_VM_TARGET: LocalVmTarget = {
  key: "shared",
  containerName: CONTAINER,
  workspaceDir: VM_WORKSPACE_DIR,
  viewerPort: HOST_VIEWER_PORT,
  label: "shared",
};

/** Identities come from a digest, never a bot's display name or a caller-controlled path fragment. */
export function perBotLocalVmTarget(botId: string): LocalVmTarget {
  const digest = createHash("sha256").update(botId).digest("hex");
  const short = digest.slice(0, 16);
  return {
    key: `bot:${digest}`,
    containerName: `${CONTAINER}-${short}`,
    workspaceDir: join(DATA_DIR, "vm-homes", short),
    viewerPort: null,
    label: digest,
  };
}

/** Seat identities stay disjoint from the shared singleton and per-bot digests, so the three modes never meet. */
export function poolLocalVmTarget(seat: number): LocalVmTarget {
  return {
    key: `pool:${seat}`,
    containerName: `${CONTAINER}-p${seat}`,
    workspaceDir: join(DATA_DIR, "vm-homes", `pool-${seat}`),
    viewerPort: null,
    label: `pool-${seat}`,
  };
}

/** Only provisioning creates this durable directory; idle shutdown keeps it. */
export function localVmWorkspaceExists(target: LocalVmTarget): boolean {
  try {
    return lstatSync(target.workspaceDir, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

const LINUX_WHEELS = {
  x86_64: {
    url: "https://files.pythonhosted.org/packages/3b/b0/97f6d8828b8a6ca3649ad7150ddbc23addde56f014c9bd407876484ecb8d/cua_driver-0.37.0-py3-none-manylinux_2_31_x86_64.whl",
    sha256: "e530ee36226d99516ef7ec696ba31d516e487ae5e5effdd5e2610c56af3eee19",
  },
  aarch64: {
    url: "https://files.pythonhosted.org/packages/dc/33/81e2531353837f80358fbf56629a74f50d7f097af4b5f67626b0afce2d61/cua_driver-0.37.0-py3-none-manylinux_2_31_aarch64.whl",
    sha256: "1a0103fd7fa5e9d51ee3ce26d502eb4187702282b3f4bcf1e9c09c6ce9f9d558",
  },
} as const;

const NODE_RUNTIME = {
  version: "24.22.2",
  x64: "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75",
  arm64: "eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8",
} as const;

const GOOGLE_LINUX_SIGNING_KEY = {
  url: "https://dl.google.com/linux/linux_signing_key.pub",
  sha256: "54dea5f6c2a26091578cf52a999cebc6b64df478d37ad4dce96376b711e3b27c",
} as const;

/** Debian 13 desktop, one seat per X display `:N`: Xvfb, an XFCE session, x11vnc on 127.0.0.1:590N, noVNC on 690N and a
 * Cua Driver socket. The image starts seat 1; `openmausbot-seat-conf N > /etc/supervisor/conf.d/seat-N.conf` followed by
 * `supervisorctl update` starts seat N. Node, both Cua Driver wheels and the Google signing key are SHA-256 verified. */
export function managedImageDockerfile(): string {
  return `FROM ${BASE_IMAGE}
USER root
RUN set -eux; \\
    export DEBIAN_FRONTEND=noninteractive; \\
    apt-get update; \\
    apt-get install -y --no-install-recommends \\
      ca-certificates curl xz-utils procps tini supervisor dbus dbus-x11 \\
      xvfb x11vnc x11-xserver-utils xdg-utils novnc websockify \\
      xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings xfce4-terminal exo-utils at-spi2-core \\
      fontconfig fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \\
      python3 python3-venv pulseaudio picom git gh; \\
    rm -rf /var/lib/apt/lists/*; \\
    dbus-uuidgen --ensure; \\
    groupadd -g 1000 cua; \\
    useradd -u 1000 -g 1000 -m -s /bin/bash cua; \\
    install -d -o cua -g cua -m 0700 /run/user/1000; \\
    install -d -m 1777 /tmp/.X11-unix; \\
    install -d -m 0755 /run/dbus; \\
    python3 -m venv /opt/venv
RUN set -eux; \\
    arch="$(uname -m)"; \\
    case "$arch" in \\
      x86_64) wheel_url='${LINUX_WHEELS.x86_64.url}'; wheel_sha='${LINUX_WHEELS.x86_64.sha256}'; wheel_path='/tmp/cua_driver-${CUA_DRIVER_VERSION}-py3-none-manylinux_2_31_x86_64.whl'; node_arch='x64'; node_sha='${NODE_RUNTIME.x64}' ;; \\
      aarch64|arm64) wheel_url='${LINUX_WHEELS.aarch64.url}'; wheel_sha='${LINUX_WHEELS.aarch64.sha256}'; wheel_path='/tmp/cua_driver-${CUA_DRIVER_VERSION}-py3-none-manylinux_2_31_aarch64.whl'; node_arch='arm64'; node_sha='${NODE_RUNTIME.arm64}' ;; \\
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \\
    esac; \\
    node_tar="/tmp/node-v${NODE_RUNTIME.version}-linux-$node_arch.tar.xz"; \\
    curl -fsSL "https://nodejs.org/dist/v${NODE_RUNTIME.version}/node-v${NODE_RUNTIME.version}-linux-$node_arch.tar.xz" -o "$node_tar"; \\
    echo "$node_sha  $node_tar" | sha256sum -c -; \\
    tar -xJf "$node_tar" -C /usr/local --strip-components=1 --no-same-owner --exclude='*/include' --exclude='*/share/doc' --exclude='*/share/man'; \\
    rm -f "$node_tar" /usr/local/CHANGELOG.md /usr/local/README.md /usr/local/LICENSE; \\
    test "$(node --version)" = "v${NODE_RUNTIME.version}"; \\
    curl -fsSL "$wheel_url" -o "$wheel_path"; \\
    echo "$wheel_sha  $wheel_path" | sha256sum -c -; \\
    /opt/venv/bin/python -m pip install --no-cache-dir --force-reinstall --no-deps "$wheel_path"; \\
    rm -f "$wheel_path"; \\
    driver_bin="$(find /opt/venv/lib -path '*/cua_driver/bin/cua-driver' -type f -print -quit)"; \\
    test -n "$driver_bin"; \\
    install -D -m 0755 "$driver_bin" ${CUA_EXECUTABLE}; \\
    install -d -o cua -g cua -m 0700 ${VM_WORKSPACE_GUEST}; \\
    test "$(${CUA_EXECUTABLE} --version)" = "cua-driver ${CUA_DRIVER_VERSION}"
# Install before XFCE starts so the panel and window manager see the font too.
# Noto Sans CJK JP is distributed under the SIL Open Font License 1.1.
RUN set -eux; \\
    install -d -m 0755 /usr/local/share/fonts; \\
    curl -fsSL 'https://raw.githubusercontent.com/notofonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf' -o /usr/local/share/fonts/NotoSansCJKjp-Regular.otf; \\
    echo '68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5  /usr/local/share/fonts/NotoSansCJKjp-Regular.otf' | sha256sum -c -; \\
    chmod 0644 /usr/local/share/fonts/NotoSansCJKjp-Regular.otf; \\
    install -d -m 0755 /usr/local/share/licenses/noto-cjk; \\
    curl -fsSL 'https://raw.githubusercontent.com/notofonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/LICENSE' -o /usr/local/share/licenses/noto-cjk/OFL.txt; \\
    echo '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2  /usr/local/share/licenses/noto-cjk/OFL.txt' | sha256sum -c -; \\
    fc-cache -f
# Google ships Chrome for Linux on amd64 only, and no substitute browser is allowed. Its own sandbox needs namespaces this
# hardened container (capabilities dropped, runtime seccomp) refuses, so Chrome exits with code 21; the container is the
# isolation boundary here.
RUN set -eux; \\
    if [ "$(dpkg --print-architecture)" = amd64 ]; then \\
      install -d -m 0755 /etc/apt/keyrings; \\
      curl -fsSL '${GOOGLE_LINUX_SIGNING_KEY.url}' -o /etc/apt/keyrings/google-chrome.asc; \\
      echo '${GOOGLE_LINUX_SIGNING_KEY.sha256}  /etc/apt/keyrings/google-chrome.asc' | sha256sum -c -; \\
      echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.asc] https://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list; \\
      apt-get update; \\
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends google-chrome-stable; \\
      rm -f /etc/apt/sources.list.d/google-chrome*; \\
      rm -rf /var/lib/apt/lists/*; \\
      test -x /usr/bin/google-chrome; \\
      printf '%s\\n' '#!/bin/sh' 'exec /usr/bin/google-chrome-stable --no-sandbox --no-first-run --no-default-browser-check "$@"' > /usr/local/bin/google-chrome; \\
      chmod 0755 /usr/local/bin/google-chrome; \\
      install -d -m 0755 /usr/local/share/applications /etc/xdg/xfce4; \\
      sed 's#/usr/bin/google-chrome-stable#/usr/local/bin/google-chrome#g' /usr/share/applications/google-chrome.desktop > /usr/local/share/applications/google-chrome.desktop; \\
      update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/google-chrome 300; \\
      printf '%s\\n' 'WebBrowser=google-chrome' > /etc/xdg/xfce4/helpers.rc; \\
      printf '%s\\n' '[Default Applications]' 'text/html=google-chrome.desktop' 'x-scheme-handler/http=google-chrome.desktop' 'x-scheme-handler/https=google-chrome.desktop' > /etc/xdg/mimeapps.list; \\
    else \\
      echo "Google Chrome stable is published for linux/amd64 only; build this image with --platform linux/amd64" >&2; \\
      exit 1; \\
    fi
${workspacePreparationDockerfile(VM_WORKSPACE_GUEST)}
# Driver: a 200 ms (not 800) watch for windows an action opens still sees browser popups; no cursor glide; plain logs.
RUN printf '%s\\n' \\
      '#!/bin/sh' \\
      'set -eu' \\
      'role="$1"' \\
      'seat="$2"' \\
      'case "$seat" in 1|2|3) ;; *) echo "seat must be 1, 2 or 3, not $seat" >&2; exit 2 ;; esac' \\
      'export DISPLAY=":$seat"' \\
      'if [ "$seat" != 1 ]; then export XDG_RUNTIME_DIR="/run/user/1000/seat-$seat"; mkdir -p -m 0700 "$XDG_RUNTIME_DIR"; fi' \\
      'await_display() {' \\
      '  attempt=0' \\
      '  until xset q >/dev/null 2>&1; do' \\
      '    attempt=$((attempt + 1))' \\
      '    if [ "$attempt" -ge 45 ]; then echo "X display $DISPLAY did not become ready within 45 seconds" >&2; exit 1; fi' \\
      '    sleep 1' \\
      '  done' \\
      '}' \\
      'case "$role" in' \\
      '  display)' \\
      '    /usr/local/bin/prepare-openmausbot-workspace.sh' \\
      '    rm -f "/tmp/.X$seat-lock" "/tmp/.X11-unix/X$seat"' \\
      '    exec Xvfb "$DISPLAY" -screen 0 1280x800x24 -ac +extension GLX +render -noreset -nolisten tcp ;;' \\
      '  session)' \\
      '    await_display' \\
      '    xset s off s noblank || true' \\
      '    pulseaudio --start --exit-idle-time=-1 || true' \\
      '    picom -b || true' \\
      '    exec dbus-launch --exit-with-session startxfce4 ;;' \\
      '  vnc)' \\
      '    await_display' \\
      '    if [ -r "$HOME/.vnc/passwd" ] && [ ! -w "$HOME/.vnc/passwd" ]; then exec x11vnc -display "$DISPLAY" -localhost -rfbauth "$HOME/.vnc/passwd" -shared -forever -noxdamage -rfbport "$((5900 + seat))"; fi' \\
      '    if [ -n "$(printenv VNC_PW || true)" ]; then' \\
      '      install -d -m 0700 "$HOME/.vnc"' \\
      '      umask 077' \\
      '      printenv VNC_PW > "$HOME/.vnc/passwd-$seat"' \\
      '      exec x11vnc -display "$DISPLAY" -localhost -passwdfile "rm:$HOME/.vnc/passwd-$seat" -shared -forever -noxdamage -rfbport "$((5900 + seat))"' \\
      '    fi' \\
      '    exec x11vnc -display "$DISPLAY" -localhost -nopw -shared -forever -noxdamage -rfbport "$((5900 + seat))" ;;' \\
      '  viewer)' \\
      '    exec websockify --web /usr/share/novnc "$((6900 + seat))" "127.0.0.1:$((5900 + seat))" ;;' \\
      '  driver)' \\
      '    socket=${CUA_SOCKET}' \\
      '    [ "$seat" = 1 ] || socket="/run/user/1000/openmausbot-cua-$seat.sock"' \\
      '    await_display' \\
      '    exec env CUA_DRIVER_BROWSER_NO_SANDBOX=1 CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 NO_COLOR=1 ${CUA_EXECUTABLE} serve --socket "$socket" --permission-mode standard --cursor-reduced-motion on ;;' \\
      '  *) echo "unknown seat role: $role" >&2; exit 2 ;;' \\
      'esac' \\
      > /usr/local/bin/openmausbot-seat \\
    && printf '%s\\n' \\
      '#!/bin/sh' \\
      'set -eu' \\
      'seat="$1"' \\
      'case "$seat" in 1|2|3) ;; *) echo "seat must be 1, 2 or 3, not $seat" >&2; exit 2 ;; esac' \\
      'suffix=""' \\
      '[ "$seat" = 1 ] || suffix="-$seat"' \\
      'program() {' \\
      '  printf "[program:%s%s]\\ncommand=/usr/local/bin/openmausbot-seat %s %s\\nuser=cua\\nenvironment=HOME=\\"/home/cua\\",USER=\\"cua\\",XDG_RUNTIME_DIR=\\"/run/user/1000\\"\\nautorestart=true\\nstopasgroup=true\\nkillasgroup=true\\npriority=%s\\nstdout_logfile=/var/log/supervisor/%s%s.log\\nstdout_logfile_maxbytes=1MB\\nstdout_logfile_backups=1\\nstderr_logfile=/var/log/supervisor/%s%s.error.log\\nstderr_logfile_maxbytes=1MB\\nstderr_logfile_backups=1\\n\\n" "$1" "$suffix" "$2" "$seat" "$3" "$4" "$suffix" "$4" "$suffix"' \\
      '}' \\
      'program xvfb display 10 xvfb' \\
      'program xfce session 20 xfce' \\
      'program vncserver vnc 20 vncserver' \\
      'program novnc viewer 25 novnc' \\
      'program openmausbot-cua-driver driver 30 cua-driver' \\
      > /usr/local/bin/openmausbot-seat-conf \\
    && printf '%s\\n' \\
      '#!/bin/sh' \\
      'set -eu' \\
      '/usr/local/bin/openmausbot-seat-conf "$1" > "/etc/supervisor/conf.d/seat-$1.conf"' \\
      'exec supervisorctl -c /etc/supervisor/supervisord.conf update' \\
      > /usr/local/bin/openmausbot-start-seat \\
    && chmod 0755 /usr/local/bin/openmausbot-seat /usr/local/bin/openmausbot-seat-conf /usr/local/bin/openmausbot-start-seat \\
    && printf '%s\\n' \\
      '[program:dbus]' \\
      'command=/usr/bin/dbus-daemon --system --nofork --nopidfile' \\
      'autorestart=true' \\
      'priority=1' \\
      'stdout_logfile=/var/log/supervisor/dbus.log' \\
      'stdout_logfile_maxbytes=1MB' \\
      'stderr_logfile=/var/log/supervisor/dbus.error.log' \\
      'stderr_logfile_maxbytes=1MB' \\
      > /etc/supervisor/conf.d/dbus.conf \\
    && /usr/local/bin/openmausbot-seat-conf 1 > /etc/supervisor/conf.d/seat-1.conf
LABEL ${MANAGED_LABEL}="1" \\
      ${DRIVER_LABEL}="${CUA_DRIVER_VERSION}" \\
      ${BASE_IMAGE_LABEL}="${BASE_IMAGE_DIGEST}" \\
      ${IMAGE_LAYER_LABEL}="${IMAGE_LAYER_VERSION}"
EXPOSE ${INTERNAL_VIEWER_PORT}
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
`;
}

export async function sh(cmd: string, args: string[], timeout = 8000): Promise<{ stdout: string }> {
  const resolved = resolveCliSpawn(cmd, args);
  const { stdout } = await run(resolved.command, resolved.args, {
    timeout,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: augmentedPath() },
  });
  return { stdout };
}

async function installed(
  cmd: string,
  runner: CommandRunner,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    await runner(platform === "win32" ? "where.exe" : "/usr/bin/which", [cmd], 4000);
    return true;
  } catch {
    return false;
  }
}

export interface ContainerRuntimeStatus {
  runtime: Runtime | null;
  available: Runtime[];
  daemonUp: boolean;
}

/** Inspects only the host runtime: never opens a container, calls Cua, or reads a screenshot. */
export async function containerRuntimeStatus(
  runner: CommandRunner = sh,
  platform: NodeJS.Platform = process.platform,
): Promise<ContainerRuntimeStatus> {
  // Podman is the supported Windows VM lane and owns the pinned image; Docker-first would pick an unrelated image store.
  const candidates: Runtime[] = platform === "win32"
    ? ["podman", "docker"]
    : RUNTIMES.filter((runtime) => runtime !== "container" || platform === "darwin");
  const present = await Promise.all(candidates.map((runtime) => installed(runtime, runner, platform)));
  const available = candidates.filter((_, index) => present[index]);
  const healthy = await Promise.all(
    available.map(async (candidate) => {
      try {
        const infoArgs = candidate === "container"
          ? ["system", "status"]
          : candidate === "podman"
            ? ["info", "--format", "json"]
            : ["info", "--format", "{{.ServerVersion}}"];
        await runner(
          candidate,
          infoArgs,
          10_000,
        );
        return true;
      } catch {
        return false;
      }
    }),
  );
  const healthyIndex = healthy.indexOf(true);
  return {
    runtime: healthyIndex >= 0 ? available[healthyIndex] : (available[0] ?? null),
    available,
    daemonUp: healthyIndex >= 0,
  };
}

export interface ContainerComputerStatus {
  platform: NodeJS.Platform;
  runtime: Runtime | null;
  available: Runtime[];
  daemonUp: boolean;
  image: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  persistence: "durable" | "unsafe" | "unknown";
  desktopReady: boolean;
  desktop_error: string | null;
  stopped_at?: string | null;
  /** A stopped desktop whose only problem is that it is stopped. */
  resumable: boolean;
  create_supported: boolean;
  ready: boolean;
  problem: string | null;
  image_ref: string;
  image_id: string | null;
  base_image_ref: string;
  driver_version: string;
  container_name: string;
  target_key: string;
  workspace_path: string;
  workspace_guest_path: string;
  viewer_port: number | null;
  viewer_url: string;
}

function emptyStatus(platform: NodeJS.Platform, target: LocalVmTarget): ContainerComputerStatus {
  return {
    platform,
    runtime: null,
    available: [],
    daemonUp: false,
    image: false,
    imageMatches: false,
    managed: false,
    container: "missing",
    network: "unknown",
    security: "unknown",
    persistence: "unknown",
    desktopReady: false,
    desktop_error: null,
    create_supported: true,
    resumable: false,
    ready: false,
    problem: "Install a supported container runtime first",
    image_ref: IMAGE,
    image_id: null,
    base_image_ref: BASE_IMAGE,
    driver_version: CUA_DRIVER_VERSION,
    container_name: target.containerName,
    target_key: target.key,
    workspace_path: target.workspaceDir,
    workspace_guest_path: VM_WORKSPACE_GUEST,
    viewer_port: target.viewerPort,
    viewer_url: target.viewerPort ? `http://127.0.0.1:${target.viewerPort}/vnc.html` : "",
  };
}

export function localVmRecreatableOnDemand(
  status: ContainerComputerStatus,
): status is ContainerComputerStatus & { runtime: Runtime } {
  return Boolean(status.runtime)
    && status.daemonUp
    && status.image
    && status.container === "missing"
    && status.create_supported;
}

/** Fails closed on fields a partial inspect left "unknown", which `statusProblem` alone would let through. */
export function localVmResumable(
  status: ContainerComputerStatus,
): status is ContainerComputerStatus & { runtime: Runtime } {
  return Boolean(status.runtime) && status.daemonUp && status.image && status.container === "stopped"
    && existingContainerProblem(status) === null
    && status.network === "loopback" && status.security === "hardened" && status.persistence === "durable";
}

export function localVmWakeAction(status: ContainerComputerStatus): "run" | "start" | null {
  if (localVmRecreatableOnDemand(status)) return "run";
  if (localVmResumable(status)) return "start";
  return null;
}

/** Auto attaches without a person only when ready, startable or recreatable; anything else stays the person's call. */
export function autoLocalVmAttachable(status: ContainerComputerStatus): boolean {
  return status.ready === true || localVmWakeAction(status) !== null;
}

function statusProblem(status: ContainerComputerStatus): string | null {
  if (!status.runtime) return "Install a supported container runtime first";
  if (!status.daemonUp) return `Start ${status.runtime} first`;
  if (!status.image) return `Prepare the Cua desktop image with Driver ${CUA_DRIVER_VERSION}`;
  if (status.container === "missing" && !status.create_supported) {
    return "Per-bot Local VMs require Docker or Podman because Apple container requires a fixed host port";
  }
  if (status.container === "missing") return "Create the Local VM";
  const existing = existingContainerProblem(status);
  if (existing) return existing;
  if (status.container === "stopped") return "The Local VM is stopped; start it to continue";
  if (status.desktop_error) return `The Local VM desktop failed to start: ${status.desktop_error}`;
  if (!status.desktopReady) return "The Local VM started, but Cua Driver is not ready yet";
  return null;
}

function existingContainerProblem(status: ContainerComputerStatus): string | null {
  if (!status.imageMatches) return "The existing Local VM uses an older desktop or Cua Driver; recreate it";
  if (!status.managed) return "The existing container was not created by OpenMausBot; recreate it";
  if (status.network === "unsafe") return "The existing Local VM exposes its viewer publicly; recreate it";
  if (status.security === "unsafe") return "The existing Local VM is missing safety limits; recreate it";
  if (status.persistence === "unsafe") return "The existing Local VM is missing its durable folder; recreate it";
  return null;
}

export function imageLabelsMatch(labels: Record<string, string> | undefined): boolean {
  return (
    labels?.[MANAGED_LABEL] === "1" &&
    labels?.[DRIVER_LABEL] === CUA_DRIVER_VERSION &&
    labels?.[BASE_IMAGE_LABEL] === BASE_IMAGE_DIGEST &&
    labels?.[IMAGE_LAYER_LABEL] === IMAGE_LAYER_VERSION
  );
}

/** Ownership ignores image/driver versions, so an older OMB container stays removable. */
function containerOwnershipLabelsMatch(
  labels: Record<string, string> | undefined,
  target: LocalVmTarget,
): boolean {
  return (
    labels?.[MANAGED_LABEL] === "1" &&
    labels?.[WORKSPACE_LABEL] === "1" &&
    (target.key === SHARED_LOCAL_VM_TARGET.key
      ? labels?.[TARGET_LABEL] === undefined || labels?.[TARGET_LABEL] === target.label
      : labels?.[TARGET_LABEL] === target.label)
  );
}

function normalizeImageId(id: string | undefined): string | null {
  return id?.trim().replace(/^sha256:/, "") || null;
}

function inspectedImage(stdout: string, runtime: Runtime): {
  labels: Record<string, string> | undefined;
  id: string | null;
} {
  const parsed = JSON.parse(stdout) as Array<{
    Id?: string;
    id?: string;
    Config?: { Labels?: Record<string, string> };
    config?: { Labels?: Record<string, string>; labels?: Record<string, string> };
    configuration?: { labels?: Record<string, string>; descriptor?: { digest?: string } };
    variants?: Array<{
      platform?: { os?: string; architecture?: string };
      config?: { config?: { Labels?: Record<string, string> } };
    }>;
  }>;
  const image = parsed[0];
  // Apple container puts image labels inside each platform variant; never accept another platform's or guess between several.
  const variants = runtime === "container" && Array.isArray(image?.variants)
    ? image.variants.filter(variant => variant?.platform?.os === "linux" && variant.platform.architecture === "arm64")
    : [];
  return {
    labels: runtime === "container"
      ? (variants.length === 1 ? variants[0]?.config?.config?.Labels : undefined)
      : image?.Config?.Labels ?? image?.config?.Labels ?? image?.config?.labels ?? image?.configuration?.labels,
    id: normalizeImageId(image?.Id ?? image?.id ?? image?.configuration?.descriptor?.digest),
  };
}

function viewerPassword(env: string[] | Record<string, string> | undefined): string | null {
  if (Array.isArray(env)) {
    return env.find((entry) => entry.startsWith("VNC_PW="))?.slice("VNC_PW=".length) || null;
  }
  return env?.VNC_PW || null;
}

function viewerUrl(password: string | null, port: number | null): string {
  if (!port) return "";
  const base = `http://127.0.0.1:${port}/vnc.html`;
  if (!password) return base;
  const fragment = new URLSearchParams({ autoconnect: "true", resize: "scale", password });
  return `${base}#${fragment.toString()}`;
}

export function cuaExecArgs(
  args: string[],
  options: { container?: string; interactive?: boolean } = {},
): string[] {
  return [
    "exec",
    ...(options.interactive ? ["-i"] : []),
    "-u",
    "cua",
    "-e",
    "HOME=/home/cua",
    "-e",
    `DISPLAY=${DISPLAY}`,
    "-e",
    "CUA_DRIVER_INSTALL_CHANNEL=python_package",
    "-e",
    "CUA_DRIVER_RS_TELEMETRY_ENABLED=0",
    options.container ?? CONTAINER,
    CUA_EXECUTABLE,
    ...args,
  ];
}

export async function containerComputerStatus(
  runner: CommandRunner = sh,
  platform: NodeJS.Platform = process.platform,
  target: LocalVmTarget = SHARED_LOCAL_VM_TARGET,
  options: { probeDesktop?: boolean } = {},
): Promise<ContainerComputerStatus> {
  const status = emptyStatus(platform, target);
  const runtimeStatus = await containerRuntimeStatus(runner, platform);
  status.available = runtimeStatus.available;
  status.runtime = runtimeStatus.runtime;
  status.daemonUp = runtimeStatus.daemonUp;
  status.create_supported = target.key === SHARED_LOCAL_VM_TARGET.key || status.runtime !== "container";
  if (!status.runtime || !status.daemonUp) {
    status.problem = statusProblem(status);
    return status;
  }

  try {
    const { stdout } = await runner(status.runtime, ["image", "inspect", IMAGE]);
    const image = inspectedImage(stdout, status.runtime);
    status.image = imageLabelsMatch(image.labels);
    status.image_id = image.id;
  } catch {}

  try {
    const { stdout } = await runner(status.runtime, ["inspect", target.containerName]);
    if (status.runtime === "container") {
      const inspected = JSON.parse(stdout) as Array<{
        configuration?: {
          image?: string | { reference?: string; descriptor?: { digest?: string } };
          imageReference?: string;
          resources?: { cpus?: number; memoryInBytes?: number };
          publishedPorts?: Array<{ hostAddress?: string; hostPort?: number; containerPort?: number }>;
          environment?: string[] | Record<string, string>;
          labels?: Record<string, string>;
          mounts?: Array<{ source?: string; destination?: string; options?: string[] }>;
        };
        status?: { state?: string };
      }>;
      const detail = inspected[0];
      status.container = detail?.status?.state === "running" ? "running" : "stopped";
      status.network = applePortsAreLocal(detail?.configuration?.publishedPorts) ? "loopback" : "unsafe";
      status.viewer_port = appleViewerPort(detail?.configuration?.publishedPorts, target.viewerPort);
      const appleImage =
        typeof detail?.configuration?.image === "string"
          ? detail.configuration.image
          : detail?.configuration?.image?.reference ?? detail?.configuration?.imageReference;
      const appleImageId =
        typeof detail?.configuration?.image === "object"
          ? normalizeImageId(detail.configuration.image.descriptor?.digest)
          : null;
      status.imageMatches =
        appleImage === IMAGE && status.image_id !== null && appleImageId === status.image_id;
      status.managed = containerOwnershipLabelsMatch(detail?.configuration?.labels, target);
      status.persistence = appleWorkspaceMountIsSafe(detail?.configuration?.mounts, platform, target.workspaceDir)
        ? "durable"
        : "unsafe";
      const resources = detail?.configuration?.resources;
      status.security =
        (resources?.memoryInBytes ?? 0) >= MEMORY_BYTES && resources?.cpus === 2 ? "hardened" : "unsafe";
      status.viewer_url = viewerUrl(viewerPassword(detail?.configuration?.environment), status.viewer_port);
    } else {
      const inspected = JSON.parse(stdout) as Array<{
        Config?: { Image?: string; Labels?: Record<string, string>; Env?: string[] };
        HostConfig?: DockerHardeningConfig & {
          PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
        };
        NetworkSettings?: {
          Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
        };
        Mounts?: Array<{
          Type?: string;
          Source?: string;
          Destination?: string;
          RW?: boolean;
        }>;
        EffectiveCaps?: string[];
        BoundingCaps?: string[];
        State?: { Running?: boolean; FinishedAt?: string };
        Image?: string;
      }>;
      const detail = inspected[0];
      status.container = detail?.State?.Running ? "running" : "stopped";
      status.stopped_at = status.container === "stopped" ? detail?.State?.FinishedAt ?? null : null;
      status.network = dockerPortsAreLocal(detail?.HostConfig?.PortBindings) ? "loopback" : "unsafe";
      status.viewer_port = dockerViewerPort(detail?.NetworkSettings?.Ports, target.viewerPort);
      status.imageMatches =
        detail?.Config?.Image === IMAGE &&
        imageLabelsMatch(detail?.Config?.Labels) &&
        status.image_id !== null &&
        normalizeImageId(detail?.Image) === status.image_id;
      status.managed = containerOwnershipLabelsMatch(detail?.Config?.Labels, target);
      if (status.managed) raisePidsLimit(target.containerName, detail?.HostConfig?.PidsLimit, runner.bind(null, status.runtime));
      status.persistence = dockerWorkspaceMountIsSafe(
        detail?.Mounts,
        platform,
        target.workspaceDir,
        status.runtime,
      ) ? "durable" : "unsafe";
      status.security = (
        status.runtime === "podman"
          ? podmanSecurityIsHardened(detail?.HostConfig, detail?.EffectiveCaps, detail?.BoundingCaps)
          : dockerSecurityIsHardened(detail?.HostConfig)
      ) ? "hardened" : "unsafe";
      status.viewer_url = viewerUrl(viewerPassword(detail?.Config?.Env), status.viewer_port);
    }
  } catch {
  }

  const canProbe = options.probeDesktop !== false &&
    status.container === "running" &&
    status.imageMatches &&
    status.managed &&
    status.network === "loopback" &&
    status.security === "hardened" &&
    status.persistence === "durable";
  if (canProbe) {
    try {
      const expected = `cua-driver ${CUA_DRIVER_VERSION}`;
      const version = await runner(status.runtime, cuaExecArgs(["--version"], { container: target.containerName }), 8000);
      if (version.stdout.trim() !== expected) throw new Error(`expected ${expected}`);
      await runner(status.runtime, cuaExecArgs(["status", "--socket", CUA_SOCKET], { container: target.containerName }), 8000);
      const health = await runner(
        status.runtime,
        cuaExecArgs(["call", "health_report", "{}", "--socket", CUA_SOCKET], { container: target.containerName }),
        15_000,
      );
      const report = JSON.parse(health.stdout) as { schema_version?: string; overall?: string; checks?: unknown[] };
      if (
        report.schema_version !== "1" ||
        !Array.isArray(report.checks) ||
        (report.overall !== "ok" && report.overall !== "degraded")
      ) {
        throw new Error(`Cua health report is ${report.overall ?? "invalid"}`);
      }
      const readinessShot = "/tmp/openmausbot-readiness.png";
      await runner(
        status.runtime,
        cuaExecArgs([
          "call",
          "get_desktop_state",
          "{}",
          "--socket",
          CUA_SOCKET,
          "--screenshot-out-file",
          readinessShot,
        ], { container: target.containerName }),
        20_000,
      );
      const captured = await runner(
        status.runtime,
        ["exec", target.containerName, "base64", "-w0", readinessShot],
        20_000,
      );
      if (!wholeScreenshot(Buffer.from(captured.stdout.trim(), "base64")).ok) {
        throw new Error("Cua Driver returned an incomplete readiness screenshot");
      }
      status.desktopReady = true;
    } catch (error) {
      status.desktop_error = error instanceof Error ? error.message.slice(0, 320) : null;
      try {
        const errorLog = await runner(
          status.runtime,
          ["exec", target.containerName, "tail", "-n", "4", "/var/log/supervisor/cua-driver.error.log"],
          4000,
        );
        status.desktop_error =
          errorLog.stdout.replace(/\s+/g, " ").trim().slice(0, 320) ||
          status.desktop_error;
      } catch {
      }
    }
  }

  status.problem = statusProblem(status);
  status.ready = status.problem === null;
  status.resumable = localVmResumable(status);
  return status;
}

function loopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "[::1]";
}

function dockerPortsAreLocal(
  bindings: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | undefined,
): boolean {
  const viewer = bindings?.[`${INTERNAL_VIEWER_PORT}/tcp`] ?? [];
  const published = Object.values(bindings ?? {}).flatMap((entries) => entries ?? []);
  return viewer.length > 0 && published.length === viewer.length && published.every((entry) => loopback(entry.HostIp));
}

function dockerViewerPort(
  bindings: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | undefined,
  fallback: number | null,
): number | null {
  const raw = bindings?.[`${INTERNAL_VIEWER_PORT}/tcp`]?.find((entry) => loopback(entry.HostIp))?.HostPort;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function applePortsAreLocal(
  bindings: Array<{ hostAddress?: string; hostPort?: number; containerPort?: number }> | undefined,
): boolean {
  return Boolean(
    bindings?.length === 1 &&
      bindings[0]?.containerPort === INTERNAL_VIEWER_PORT &&
      loopback(bindings[0]?.hostAddress),
  );
}

function appleViewerPort(
  bindings: Array<{ hostAddress?: string; hostPort?: number; containerPort?: number }> | undefined,
  fallback: number | null,
): number | null {
  const raw = bindings?.find(
    (binding) => binding.containerPort === INTERNAL_VIEWER_PORT && loopback(binding.hostAddress),
  )?.hostPort;
  return Number.isInteger(raw) && Number(raw) > 0 && Number(raw) <= 65_535 ? Number(raw) : fallback;
}

function sameWorkspaceSource(
  source: string | undefined,
  platform: NodeJS.Platform,
  expectedWorkspace: string,
): boolean {
  if (!source) return false;
  const actual = resolve(source);
  const expected = resolve(expectedWorkspace);
  return platform === "win32" ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
}

/** Podman Machine exposes a Windows bind source through its WSL mount path; accept only the exact translation. */
function samePodmanWindowsWorkspaceSource(source: string | undefined, expectedWorkspace: string): boolean {
  if (!source) return false;
  const match = expectedWorkspace.match(/^([A-Za-z]):[\\/](.+)$/);
  if (!match) return false;
  const expected = `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
  const actual = source.replaceAll("\\", "/");
  return actual.toLowerCase() === expected.toLowerCase();
}

function dockerWorkspaceMountIsSafe(
  mounts:
    | Array<{ Type?: string; Source?: string; Destination?: string; RW?: boolean }>
    | undefined,
  platform: NodeJS.Platform,
  expectedWorkspace: string,
  runtime: Runtime = "docker",
): boolean {
  const sourceMatches = sameWorkspaceSource(mounts?.[0]?.Source, platform, expectedWorkspace) ||
    (runtime === "podman" &&
      platform === "win32" &&
      samePodmanWindowsWorkspaceSource(mounts?.[0]?.Source, expectedWorkspace));
  return Boolean(
    mounts?.length === 1 &&
      mounts[0]?.Type === "bind" &&
      sourceMatches &&
      mounts[0]?.Destination === VM_WORKSPACE_GUEST &&
      mounts[0]?.RW !== false,
  );
}

function appleWorkspaceMountIsSafe(
  mounts: Array<{ source?: string; destination?: string; options?: string[] }> | undefined,
  platform: NodeJS.Platform,
  expectedWorkspace: string,
): boolean {
  const options = mounts?.[0]?.options ?? [];
  return Boolean(
    mounts?.length === 1 &&
      sameWorkspaceSource(mounts[0]?.source, platform, expectedWorkspace) &&
      mounts[0]?.destination === VM_WORKSPACE_GUEST &&
      !options.some((option) => option === "ro" || option === "readonly"),
  );
}

export interface DockerHardeningConfig {
  Memory?: number;
  MemorySwap?: number;
  NanoCpus?: number;
  PidsLimit?: number | null;
  CapDrop?: string[] | null;
  CapAdd?: string[] | null;
  Privileged?: boolean;
  PidMode?: string;
  IpcMode?: string;
  UTSMode?: string;
  ShmSize?: number;
  Devices?: unknown[] | null;
  DeviceRequests?: unknown[] | null;
  SecurityOpt?: string[] | null;
  UsernsMode?: string;
  CgroupnsMode?: string;
  OomKillDisable?: boolean | null;
  AutoRemove?: boolean;
  RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
}

/** Shared isolation contract for Local VM and VPS containers; Podman alone needs chroot for Firefox's sandbox. */
export function dockerSecurityIsHardened(
  config: DockerHardeningConfig | undefined,
  options: { restartPolicy?: "no" | "unless-stopped" | "any"; podmanBrowserSandbox?: boolean } = {},
): boolean {
  if (!config) return false;
  const capDrop = (config.CapDrop ?? []).map((cap) => cap.toLowerCase());
  const capAdd = (config.CapAdd ?? [])
    .map((cap) => cap.toLowerCase().replace(/^cap_/, ""))
    .sort();
  const unsafeSecurityOption = (config.SecurityOpt ?? []).some((option) => /(?:^|=)(?:unconfined|disable)$/i.test(option));
  const restartPolicy = config.RestartPolicy?.Name;
  const restartPolicyOk =
    options.restartPolicy === "any" || (options.restartPolicy === "unless-stopped"
      ? restartPolicy === "unless-stopped"
      : restartPolicy === undefined || restartPolicy === "" || restartPolicy === "no");
  return (
    capDrop.includes("all") &&
    capAdd.join(",") === (options.podmanBrowserSandbox ? "setgid,setuid,sys_chroot" : "setgid,setuid") &&
    config.Privileged === false &&
    !config.PidMode &&
    config.IpcMode === "private" &&
    !config.UTSMode &&
    (!config.Devices || config.Devices.length === 0) &&
    (!config.DeviceRequests || config.DeviceRequests.length === 0) &&
    !unsafeSecurityOption &&
    !config.UsernsMode &&
    config.CgroupnsMode === "private" &&
    config.AutoRemove !== true &&
    restartPolicyOk
  );
}

/** Podman normalizes HostConfig capability and namespace fields in inspect output, so its effective/bounding sets decide. */
export function podmanSecurityIsHardened(
  config: DockerHardeningConfig | undefined,
  effectiveCaps: string[] | undefined,
  boundingCaps: string[] | undefined,
): boolean {
  if (!config) return false;
  const normalizeCaps = (caps: string[] | undefined) => (caps ?? [])
    .map((cap) => cap.toLowerCase().replace(/^cap_/, ""))
    .sort();
  const exactCaps = "setgid,setuid,sys_chroot";
  if (normalizeCaps(effectiveCaps).join(",") !== exactCaps) return false;
  if (normalizeCaps(boundingCaps).join(",") !== exactCaps) return false;
  return dockerSecurityIsHardened({
    ...config,
    CapDrop: ["all"],
    CapAdd: effectiveCaps,
    PidMode: config.PidMode === "private" ? "" : config.PidMode,
    UTSMode: config.UTSMode === "private" ? "" : config.UTSMode,
    // Rootless keep-id maps the workspace owner to the guest cua account; never arbitrary userns sharing or host namespaces.
    UsernsMode: config.UsernsMode === "private" || config.UsernsMode === "keep-id:uid=1000,gid=1000"
      ? "" : config.UsernsMode,
    CgroupnsMode: config.CgroupnsMode || "private",
  }, { podmanBrowserSandbox: true });
}

export function containerRunArgs(
  runtime: Runtime,
  password = "CHANGE_ME",
  target: LocalVmTarget = SHARED_LOCAL_VM_TARGET,
): string[] {
  if (runtime === "container" && target.key !== SHARED_LOCAL_VM_TARGET.key) {
    throw new Error("Per-bot Local VMs require Docker or Podman because Apple container requires a fixed host port");
  }
  const common = ["run", "-d", "--name", target.containerName];
  if (runtime === "podman") {
    // The supervisor starts as namespace-root then drops to cua (1000); keep-id preserves the host workspace owner instead of :U chown.
    common.push("--userns", "keep-id:uid=1000,gid=1000", "--user", "0:0");
  }
  common.push(
    "--label",
    `${MANAGED_LABEL}=1`,
    "--label",
    `${DRIVER_LABEL}=${CUA_DRIVER_VERSION}`,
    "--label",
    `${BASE_IMAGE_LABEL}=${BASE_IMAGE_DIGEST}`,
    "--label",
    `${IMAGE_LAYER_LABEL}=${IMAGE_LAYER_VERSION}`,
    "--label",
    `${WORKSPACE_LABEL}=1`,
    "--label",
    `${TARGET_LABEL}=${target.label}`,
  );
  if (runtime === "container") {
    // Apple container already places each Linux container in a lightweight VM.
    common.push(
      "--memory",
      "4g",
      "--cpus",
      "2",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "SETUID",
      "--cap-add",
      "SETGID",
      "--shm-size",
      "512m",
    );
  } else {
    common.push(
      "--hostname",
      target.containerName,
      "--memory",
      "4g",
      "--memory-swap",
      "4g",
      "--cpus",
      "2",
      "--pids-limit", String(PIDS_LIMIT),
      // Pinned: a daemon with host-mode IPC/cgroup defaults would create a container the hardening check then rejects.
      "--ipc",
      "private",
      "--cgroupns",
      "private",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "SETUID",
      "--cap-add",
      "SETGID",
      "--shm-size",
      "512m",
    );
  }
  // Podman's default seccomp profile gates chroot on this capability, and Firefox chroots to build its sandbox.
  if (runtime === "podman") common.push("--cap-add", "SYS_CHROOT");
  common.push(
    "--mount",
    runtime === "podman"
      ? `type=bind,source=${target.workspaceDir},target=${VM_WORKSPACE_GUEST},relabel=private`
      : `type=bind,source=${target.workspaceDir},target=${VM_WORKSPACE_GUEST}`,
    "-e",
    `VNC_PW=${password}`,
    "-p",
    target.viewerPort
      ? `127.0.0.1:${target.viewerPort}:${INTERNAL_VIEWER_PORT}`
      : `127.0.0.1::${INTERNAL_VIEWER_PORT}`,
    IMAGE,
  );
  return common;
}

const GUEST_UID = 1000;

/** The guest (uid 1000) may own its bind-mounted workspace while the app runs as another uid (a VPS service user), which
 * cannot chmod it. Such a directory is left as is once it is proven a real directory inside its parent, never a link. */
export async function ensureVmWorkspace(
  platform: NodeJS.Platform,
  target: LocalVmTarget,
  appUid: number = process.getuid?.() ?? GUEST_UID,
): Promise<void> {
  await mkdir(target.workspaceDir, { recursive: true, mode: 0o700 });
  if (platform === "win32") return;
  const entry = await lstat(target.workspaceDir);
  const real = await realpath(target.workspaceDir);
  if (!entry.isDirectory() || !real.startsWith(`${await realpath(dirname(target.workspaceDir))}${sep}`)) {
    throw new Error(`The Local VM workspace ${target.workspaceDir} must be a real directory, not a link`);
  }
  if (entry.uid !== appUid) return;
  await chmod(target.workspaceDir, platform !== "linux" || appUid === GUEST_UID ? 0o700 : 0o755);
}

function imagePullArgs(runtime: Runtime): string[] {
  const ref = IMAGE === BUILT_IMAGE ? BASE_IMAGE : IMAGE;
  return runtime === "container" ? ["image", "pull", ref] : ["pull", ref];
}

async function prepareManagedImage(runtime: Runtime, runner: CommandRunner): Promise<void> {
  await runner(runtime, imagePullArgs(runtime), 10 * 60_000);
  if (IMAGE !== BUILT_IMAGE) return;
  const context = await mkdtemp(join(tmpdir(), "openmausbot-cua-image-"));
  try {
    await writeFile(join(context, "Dockerfile"), managedImageDockerfile(), { mode: 0o600 });
    await runner(runtime, ["build", "-t", IMAGE, context], 10 * 60_000);
  } finally {
    await rm(context, { recursive: true, force: true });
  }
}

export async function containerComputerAction(
  action: LifecycleAction,
  runner: CommandRunner = sh,
  platform: NodeJS.Platform = process.platform,
  target: LocalVmTarget = SHARED_LOCAL_VM_TARGET,
): Promise<ContainerComputerStatus> {
  if (runner === sh && platform === process.platform) screenshotStatusCache.delete(target.key);
  const before = await containerComputerStatus(runner, platform, target);
  const runtime = before.runtime;
  if (!runtime) throw Object.assign(new Error(before.problem ?? "No container runtime is installed"), { status: 409 });
  if (!before.daemonUp) throw Object.assign(new Error(before.problem ?? `${runtime} is not running`), { status: 409 });

  if (action === "run" && before.container !== "missing") {
    throw Object.assign(new Error("A Local VM already exists; remove it before creating a replacement"), { status: 409 });
  }
  if (action === "run" && !before.image) {
    throw Object.assign(new Error("Prepare the Cua desktop image before creating the Local VM"), { status: 409 });
  }
  if (action === "run" && !before.create_supported) {
    throw Object.assign(new Error(before.problem ?? "This runtime cannot create a per-bot Local VM"), { status: 409 });
  }
  if (action === "start" && !localVmResumable(before)) {
    throw Object.assign(new Error(before.problem ?? "The Local VM is not stopped"), { status: 409 });
  }
  if (action === "stop" && before.container !== "running") {
    throw Object.assign(new Error("The Local VM is not running"), { status: 409 });
  }
  if (action === "remove" && before.container === "missing") return before;
  if (action === "remove" && !before.managed) {
    throw Object.assign(
      new Error(
        `The existing container named ${target.containerName} was not created by OpenMausBot; remove it manually in ${runtime}`,
      ),
      { status: 409 },
    );
  }

  if (action === "pull") {
    await prepareManagedImage(runtime, runner);
  } else {
    if (action === "run") await ensureVmWorkspace(platform, target);
    const args =
      action === "run"
        ? containerRunArgs(runtime, randomBytes(6).toString("base64url"), target)
        : action === "remove"
          ? ["rm", runtime === "container" ? "--force" : "-f", target.containerName]
          : [action, target.containerName];
    await runner(runtime, args, 2 * 60_000);
  }
  return containerComputerStatus(runner, platform, target);
}

export async function containerComputerExists(
  runtime: Runtime,
  target: LocalVmTarget,
  runner: CommandRunner = sh,
): Promise<boolean> {
  try {
    await runner(runtime, ["inspect", target.containerName], 8_000);
    return true;
  } catch {
    return false;
  }
}

export type ScreenshotCheck = { ok: boolean; mime: "image/png" | "image/jpeg" };

/** A truncated base64 transfer must never become a "successful" preview frame. */
export function wholeScreenshot(bytes: Buffer): ScreenshotCheck {
  if (bytes.length < 512) return { ok: false, mime: "image/png" };
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (png) {
    return {
      ok: bytes.subarray(Math.max(0, bytes.length - 12)).includes(Buffer.from("IEND", "ascii")),
      mime: "image/png",
    };
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return {
    ok: jpeg && bytes.subarray(Math.max(0, bytes.length - 32)).includes(Buffer.from([0xff, 0xd9])),
    mime: "image/jpeg",
  };
}

export async function containerComputerFrame(
  runner: CommandRunner = sh,
  platform: NodeJS.Platform = process.platform,
  target: LocalVmTarget = SHARED_LOCAL_VM_TARGET,
): Promise<{ png: string; format: "png" | "jpeg" }> {
  const cacheable = runner === sh && platform === process.platform;
  const now = Date.now();
  const cached = screenshotStatusCache.get(target.key);
  const status =
    cacheable && cached && cached.expiresAt > now
      ? cached.status
      : await containerComputerStatus(runner, platform, target);
  if (!status.ready || !status.runtime) {
    if (cacheable) screenshotStatusCache.delete(target.key);
    throw Object.assign(new Error(status.problem ?? "The Local VM is not ready"), { status: 409 });
  }
  if (cacheable) screenshotStatusCache.set(target.key, { status, expiresAt: now + SCREENSHOT_STATUS_TTL_MS });
  try {
    const screenshot = "/tmp/openmausbot-preview.png";
    await runner(
      status.runtime,
      cuaExecArgs([
        "call",
        "get_desktop_state",
        "{}",
        "--socket",
        CUA_SOCKET,
        "--screenshot-out-file",
        screenshot,
      ], { container: target.containerName }),
      30_000,
    );
    const { stdout } = await runner(
      status.runtime,
      ["exec", target.containerName, "base64", "-w0", screenshot],
      30_000,
    );
    const data = stdout.trim();
    const checked = wholeScreenshot(Buffer.from(data, "base64"));
    if (!checked.ok) {
      throw Object.assign(new Error("Cua Driver returned an incomplete screenshot"), { status: 502 });
    }
    return { png: data, format: checked.mime === "image/jpeg" ? "jpeg" : "png" };
  } catch (error) {
    if (cacheable) screenshotStatusCache.delete(target.key);
    throw error;
  }
}

export async function containerComputerScreenshot(
  runner: CommandRunner = sh,
  platform: NodeJS.Platform = process.platform,
  target: LocalVmTarget = SHARED_LOCAL_VM_TARGET,
): Promise<string> {
  const { png, format } = await containerComputerFrame(runner, platform, target);
  return `data:image/${format};base64,${png}`;
}

const screenshotStatusCache = new Map<
  string,
  { status: ContainerComputerStatus; expiresAt: number }
>();

const containerMcpPath = SPAWNED_PROXIES.containerMcp;

export interface ContainerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type ContainerExecRunner = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

const EXEC_DEFAULT_SECONDS = 60;
const EXEC_MAX_SECONDS = 300;
const EXEC_OUTPUT_LIMIT = 20_000;

export function clipExecOutput(text: string, limit = EXEC_OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit / 5);
  return `${text.slice(0, head)}\n… ${text.length - limit} characters omitted …\n${text.slice(text.length - (limit - head))}`;
}

const defaultExecRunner: ContainerExecRunner = async (command, args, options) => {
  const resolved = resolveCliSpawn(command, args);
  try {
    const { stdout, stderr } = await run(resolved.command, resolved.args, {
      timeout: options.timeout,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PATH: augmentedPath() },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: unknown; killed?: boolean; message?: string };
    if (typeof failure.code === "number") {
      return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.code };
    }
    throw Object.assign(new Error(failure.killed ? "the command client timed out" : failure.message ?? "could not run the command"), { status: 502 });
  }
};

/** The limit is enforced inside the container, so a runaway process is really stopped. */
export async function containerExec(
  target: LocalVmTarget,
  command: string,
  options: { timeoutSeconds?: number; runtime?: Runtime; exec?: ContainerExecRunner } = {},
): Promise<ContainerExecResult> {
  if (!command.trim()) throw Object.assign(new Error("command is required"), { status: 400 });
  if (command.length > 20_000) throw Object.assign(new Error("command is too long"), { status: 400 });
  if (options.timeoutSeconds !== undefined && !Number.isFinite(options.timeoutSeconds)) {
    throw Object.assign(new Error("timeout_seconds must be finite"), { status: 400 });
  }
  const runtime = options.runtime ?? (await containerRuntimeStatus()).runtime;
  if (!runtime) throw Object.assign(new Error("No container runtime is available for the Local VM"), { status: 409 });
  const seconds = Math.min(Math.max(Math.floor(options.timeoutSeconds ?? EXEC_DEFAULT_SECONDS), 1), EXEC_MAX_SECONDS);
  const result = await (options.exec ?? defaultExecRunner)(
    runtime,
    [
      "exec",
      "-u", "cua",
      "-w", VM_WORKSPACE_GUEST,
      "-e", "HOME=/home/cua",
      "-e", `DISPLAY=${DISPLAY}`,
      target.containerName,
      "timeout", "-k", "5", String(seconds),
      "sh", "-lc", command,
    ],
    { timeout: (seconds + 20) * 1000 },
  );
  const timedOut = result.code === 124 || result.code === 137;
  return { exitCode: result.code, stdout: clipExecOutput(result.stdout), stderr: clipExecOutput(result.stderr), timedOut };
}

type ContainerMcpLaunch = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export function containerComputerMcp(
  runtime: Runtime,
  control?: { url: string; token: string },
  target: LocalVmTarget = SHARED_LOCAL_VM_TARGET,
): ContainerMcpLaunch {
  return {
    command: process.execPath,
    args: [containerMcpPath, runtime, target.containerName, CUA_SOCKET],
    // The control pair rides in env, not argv, which `ps` shows for the bridge's whole life.
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      ...(control ? { OMB_CONTROL_URL: control.url, OMB_CONTROL_TOKEN: control.token } : {}),
    },
  };
}

export function setupCommands(
  runtime: Runtime | null,
  platform: NodeJS.Platform = process.platform,
  target: LocalVmTarget = SHARED_LOCAL_VM_TARGET,
) {
  const install =
    platform === "darwin"
      ? "brew install podman; podman machine init; podman machine start"
      : platform === "win32"
        ? "winget install -e --id RedHat.Podman-Desktop"
        : null;
  const runtimeStart =
    runtime === "container"
      ? "container system start"
      : runtime === "podman" && platform !== "linux"
        ? "podman machine init; podman machine start"
        : runtime === "docker" && platform === "darwin"
          ? "colima start || open -a Docker"
          : runtime === "docker" && platform === "linux"
            ? "sudo systemctl start docker"
            : null;

  if (!runtime) {
    return {
      install,
      runtimeStart: null,
      pull: null,
      run: null,
      start: null,
      stop: null,
      remove: null,
      view: target.viewerPort ? `http://127.0.0.1:${target.viewerPort}/vnc.html` : "",
    };
  }
  const command = (args: string[]) => [runtime, ...args].join(" ");
  return {
    install,
    runtimeStart,
    pull: command(imagePullArgs(runtime)),
    run:
      runtime === "container" && target.key !== SHARED_LOCAL_VM_TARGET.key
        ? null
        : command(containerRunArgs(runtime, "CHANGE_ME", target)),
    start: command(["start", target.containerName]),
    stop: command(["stop", target.containerName]),
    remove: command(["rm", runtime === "container" ? "--force" : "-f", target.containerName]),
    view: target.viewerPort ? `http://127.0.0.1:${target.viewerPort}/vnc.html` : "",
  };
}
