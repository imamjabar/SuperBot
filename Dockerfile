# SuperBot harness server — self-hosted tenant image.
#
# Build the renderer + the self-contained server bundle, then ship only those
# artifacts on a slim Node runtime. The runtime stage holds what changes
# rarely (Chrome's libraries, agent-browser and its Chrome), and each image
# adds its engine CLIs before the app files, which change with every commit:
# a code-only change rebuilds only the small app layers, so a pull downloads
# only those. The server keeps binding 127.0.0.1 inside the container (the
# loopback-trust invariant is the auth model); deploy/docker-compose.yml puts
# Caddy in the same network namespace to terminate TLS and authentication at
# the edge.
#
#   docker build -t superbot .
#   docker build --build-arg ENGINES="@anthropic-ai/claude-code @openai/codex" -t superbot .
#   docker buildx build --platform linux/arm64 -t superbot .   # Raspberry Pi 4/5, ARM servers
#
# HOME is the /data volume, so engine CLI logins (~/.claude, ~/.codex, ~/.grok,
# ...) and SuperBot's own state (~/.openmausbot) persist across container
# restarts.
#
# A plain `docker run` wants `--init --shm-size=512m`, as the compose files
# set: the bots' browsers leave exited processes for an init to collect, and
# Chrome needs shared memory (docs/browser-packaging.md, "Process hygiene").
# The JavaScript build is the same for every CPU, so it runs once on the build
# host's own; only the Data engine's native tree below follows the image's CPU.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /src
# pinned to package.json#packageManager; corepack is being removed from Node
RUN npm install -g pnpm@10.33.0
# The image never runs Electron, so skip its ~100MB postinstall download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# every workspace member's manifest must exist before install resolves the lockfile
COPY apps/docs/package.json ./apps/docs/package.json
# package.json's `prepare` runs during install. The script itself is written to
# no-op without a .git (it exits 0 here), but node still has to be able to LOAD
# it, and .dockerignore keeps .git out — so copy it in before install or the
# whole build dies on MODULE_NOT_FOUND.
COPY scripts/install-git-hooks.mjs ./scripts/install-git-hooks.mjs
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:server && pnpm exec vite build && chmod -R go-w dist dist-server skills
# The Data engine's native modules (server/data/engine.ts), staged like the
# desktop app's extraResources for the image's CPU (amd64 -> x64, arm64), into
# one tree the runtime stages copy. pnpm installed both CPUs' packages
# (pnpm-workspace.yaml supportedArchitectures).
ARG TARGETARCH
RUN arch=x64 && if [ "$TARGETARCH" = arm64 ]; then arch=arm64; fi \
  && OMB_DUCKDB_ARCH=$arch node scripts/prepare-duckdb.mjs \
  && mv "dist-native/duckdb/linux-$arch" dist-native/duckdb/target && chmod -R go-w dist-native/duckdb

FROM node:24-bookworm-slim AS runtime
# Install Chrome's Bookworm libraries directly: agent-browser --with-deps
# invokes sudo even as root, and this image deliberately does not ship sudo.
# git + curl: agent CLIs shell out to git; curl backs the healthcheck
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
    libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 \
    libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libgtk-3-0 \
    libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 \
    libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2 libfreetype6 \
    libfontconfig1 libdbus-1-3 libnss3 libnss3-tools libnspr4 \
    libatk-bridge2.0-0 libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 \
    libxshmfence1 libgbm1 fonts-noto-color-emoji fonts-noto-cjk fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --home-dir /data --shell /bin/bash maus
# The bots' browser (docs/plans/browser-engine.md): the pinned agent-browser
# and a Chrome for Testing with its libraries, so a server bot can browse.
# Pin here and in server/browser-engine-release.ts together.
ARG AGENT_BROWSER_VERSION=0.37.0
# `agent-browser install` fetches Chrome for Testing's last-known-good Stable;
# the publish job passes that version so a Chrome release rebuilds this layer.
ARG CHROME_CACHE_TAG=""
# Chrome for Testing has no Linux ARM64 build, so an arm64 image takes
# Debian's Chromium instead, linked at the same path; the publish job passes
# its newest bookworm version so a Debian security update rebuilds it too.
ARG CHROMIUM_CACHE_TAG=""
ARG TARGETARCH
# The global link must be the native binary for this platform (agent-browser's
# postinstall points it there); the other platforms' binaries are never run.
RUN echo "agent-browser ${AGENT_BROWSER_VERSION}, Chrome for Testing ${CHROME_CACHE_TAG:-Stable}, Debian Chromium ${CHROMIUM_CACHE_TAG:-latest}" \
  && npm install -g --cache /tmp/npm-cache agent-browser@${AGENT_BROWSER_VERSION} \
  && if [ "$TARGETARCH" = arm64 ]; then \
       apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/* \
       && mkdir -p /opt/openmausbot-browser && ln -s /usr/lib/chromium/chromium /opt/openmausbot-browser/chrome; \
     else HOME=/opt/openmausbot-browser agent-browser install \
       && ln -s /opt/openmausbot-browser/.agent-browser/browsers/chrome-*/chrome /opt/openmausbot-browser/chrome; \
     fi \
  && native="$(readlink -f "$(command -v agent-browser)")" \
  && case "$native" in */agent-browser/bin/agent-browser-linux-*) ;; *) echo "agent-browser is not a native binary: $native" >&2; exit 1;; esac \
  && [ "$(head -c 4 "$native")" = "$(printf '\177ELF')" ] \
  && for binary in "${native%/*}"/agent-browser-*; do [ "$binary" = "$native" ] || rm "$binary"; done \
  && agent-browser --version \
  && rm -rf /tmp/npm-cache /tmp/node-compile-cache
# Keep the baked-in browser outside both root's private home and /data,
# which may be an existing mounted volume. Session state still lives in HOME,
# which each image sets after its last build step, so no build step writes
# into what a fresh volume starts with.
#  OMB_DUCKDB_DIR: the DuckDB binding tree the server requires (no node_modules here).
ENV AGENT_BROWSER_EXECUTABLE_PATH=/opt/openmausbot-browser/chrome \
    OMB_DUCKDB_DIR=/app/duckdb \
    OMB_DATA_DIR=/data/.openmausbot \
    OMB_STATIC_DIR=/app/dist \
    OMB_PORT=8799 \
    OMB_WEBHOOK_PORT=8800 \
    NODE_ENV=production
WORKDIR /app

# The self-hosted server, last so a plain `docker build .` builds it.
FROM runtime AS server
# Optional engine CLIs baked into the image (space-separated npm packages).
ARG ENGINES=""
RUN if [ -n "$ENGINES" ]; then HOME=/tmp/omb-build-home npm install -g $ENGINES && rm -rf /tmp/omb-build-home /tmp/node-compile-cache; fi
COPY --from=build --chown=maus:maus /src/dist-native/duckdb/target ./duckdb
COPY --from=build --chown=maus:maus /src/dist-server ./dist-server
COPY --from=build --chown=maus:maus /src/dist ./dist
COPY --from=build --chown=maus:maus /src/skills ./skills
ENV HOME=/data
VOLUME ["/data"]
USER maus
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf http://127.0.0.1:8799/api/health | grep -q superbot || exit 1
# The launcher runs dist-server/index.js and starts it again when it asks to
# (a copied workspace committing, server/restart.ts), so the container, and a
# Caddy sharing its network, stays up through that restart.
CMD ["node", "dist-server/server-launcher.js"]
