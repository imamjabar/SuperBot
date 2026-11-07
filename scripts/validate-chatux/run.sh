#!/usr/bin/env bash
# Usage: scripts/validate-chatux/run.sh <run id>, where the run comes from
#   gh workflow run check.yml --ref ux/main-chat-progress -f scope_only=true -f probe_dist=true
# Downloads that run's chatux-probe-dist artifact (no local build), copies it and the probe client to the VPS,
# and runs probe.sh there in a disposable container. PROBE_SCENARIO=single runs one Kompas job under a
# PROBE_JOB_CALLS (default 10) tool-call budget and a 3-minute limit; the default is the two-request overlap.
set -euo pipefail
RUN_ID=${1:?usage: run.sh <run id>}
HERE=$(cd "$(dirname "$0")" && pwd)
SSH=(ssh -o BatchMode=yes -o ClearAllForwardings=yes superbot)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

gh run download "$RUN_ID" -n chatux-probe-dist -D "$WORK"
scp -q -o BatchMode=yes "$WORK/chatux-probe-dist.tgz" superbot:/tmp/omb-chatux-probe-dist.tgz
scp -q -o BatchMode=yes "$HERE/probe.mjs" superbot:/tmp/omb-chatux-probe.mjs
"${SSH[@]}" "PROBE_SCENARIO=${PROBE_SCENARIO:-overlap} PROBE_JOB_CALLS=${PROBE_JOB_CALLS:-10} bash -s" < "$HERE/probe.sh" | tail -30
