#!/usr/bin/env bash
# Runs on the VPS through `ssh superbot 'bash -s' < probe.sh` (run.sh copies its inputs first).
# Touches only its own container and temp dir: never superbot-omb-1, caddy, /data, the desktop seat or web-pull.
set -euo pipefail

NAME=omb-chatux-probe
PORT=8797
IMAGE=openmausbot-local:latest
DIST=/tmp/omb-chatux-probe-dist.tgz
CLIENT=/tmp/omb-chatux-probe.mjs
LOG=/tmp/omb-chatux-probe.log
SHOT=/tmp/omb-chatux-probe.png
SCENARIO=${PROBE_SCENARIO:-overlap}
JOB_CALLS=${PROBE_JOB_CALLS:-10}
[ "$SCENARIO" = single ] && CLIENT_MS=180000 || CLIENT_MS=480000

avail=$(awk '/MemAvailable/ { print int($2 / 1024) }' /proc/meminfo)
[ "$avail" -ge 2048 ] || { echo "abort: only ${avail} MB available"; exit 2; }
[ -f "$DIST" ] && [ -f "$CLIENT" ] || { echo "abort: run.sh did not copy $DIST and $CLIENT"; exit 2; }
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then echo "abort: $NAME already exists"; exit 2; fi

TMP=$(mktemp -d /tmp/omb-chatux-probe.XXXXXX)
LOGGER=
cleanup() {
  [ -n "$LOGGER" ] && kill "$LOGGER" 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run --rm -u 0 -v "$TMP":/t --entrypoint sh "$IMAGE" -c 'rm -rf /t/data /t/dist /t/dist-server /t/run /t/env' >/dev/null 2>&1 || true
  rm -rf "$TMP" "$DIST" "$CLIENT"
}
trap cleanup EXIT

tar -xzf "$DIST" -C "$TMP"
mkdir -p "$TMP/data/.openmausbot" "$TMP/run"
cat > "$TMP/data/.openmausbot/config.json" <<'JSON'
{ "defaultModelSelection": { "instanceId": "openaiCompat", "model": "deepseek/deepseek-v4.1-flash" }, "openaiCompat": { "model": "deepseek/deepseek-v4.1-flash" },
  "features": { "frontDesk": true, "browser": false }, "onboarding": { "completedAt": "2026-11-07T00:00:00.000Z", "version": 1 } }
JSON
chmod -R a+rwX "$TMP/data" "$TMP/run"
cp "$CLIENT" "$TMP/run/probe.mjs"
docker inspect superbot-omb-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^OPENAI_COMPAT_(URL|API_KEY)=' > "$TMP/env"
chmod 600 "$TMP/env"
[ "$(wc -l < "$TMP/env")" -eq 2 ] || { echo "abort: gateway settings not found"; exit 2; }

docker run -d --name "$NAME" --memory 2g --env-file "$TMP/env" \
  -e TZ=Asia/Jakarta -e HOME=/data -e OMB_DATA_DIR=/data/.openmausbot -e OMB_PORT=$PORT -e OMB_STATIC_DIR=/app/dist -e NODE_ENV=production -e OMB_JOB_TOOL_CALLS=$JOB_CALLS \
  -v "$TMP/data":/data -v "$TMP/dist":/app/dist:ro -v "$TMP/dist-server":/app/dist-server:ro -v "$TMP/run":/probe-run \
  "$IMAGE" >/dev/null
docker logs -f -t "$NAME" > "$TMP/run/server.log" 2>&1 &
LOGGER=$!

started=$(date +%s)
summary=$(timeout 600 docker exec -e PROBE_PORT=$PORT -e PROBE_TIMEOUT_MS=$CLIENT_MS -e PROBE_SCENARIO=$SCENARIO -e PROBE_JOB_CALLS=$JOB_CALLS "$NAME" node /probe-run/probe.mjs || echo '{"ok":false,"error":"probe client exited or timed out"}')
{
  echo "branch build: $(cat "$TMP/dist-server/server-dist-manifest.json" 2>/dev/null)"
  echo "wall: $(( $(date +%s) - started )) s"
  grep -E '\[omb-timing\]|Error|error' "$TMP/run/server.log" | grep -v -iE 'key|token|secret|authorization' | tail -60 || true
  cat "$TMP/run/digest.json" 2>/dev/null || true
  echo
  echo "$summary"
} > "$LOG"
if [ -f "$TMP/run/final.png" ]; then cp "$TMP/run/final.png" "$SHOT"; fi

echo "manifest $(cat "$TMP/dist-server/server-dist-manifest.json")"
echo "log $LOG ($(wc -l < "$LOG") lines)$([ -f "$SHOT" ] && echo ", screenshot $SHOT")"
echo "$summary"
