#!/bin/sh
# Runs on the VPS. Pulls the CI-built web-dist and server-dist branches and recreates omb without building.
set -eu
cd "$HOME/SuperBot"

REPO="${SUPERBOT_REPO:-https://github.com/imamjabar/SuperBot.git}"
C="docker compose -p superbot -f compose.yaml -f compose.override.yaml"
changed=0

# Prints 1 when $dir was moved to a new commit of $branch, 0 when unchanged, 2 when the branch is absent.
sync_branch() {
  dir=$1 branch=$2
  [ -d "$dir/.git" ] || { mkdir -p "$dir"; git -C "$dir" init -q; }
  chmod -R u+w "$dir"
  git -C "$dir" remote get-url origin >/dev/null 2>&1 || git -C "$dir" remote add origin "$REPO"
  git -C "$dir" remote set-url origin "$REPO"
  if ! git -C "$dir" fetch -q --depth 1 origin "$branch" 2>/dev/null; then echo 2; return; fi
  rev=$(git -C "$dir" rev-parse FETCH_HEAD)
  [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true)" = "$rev" ] && { echo 0; return; }
  git -C "$dir" reset -q --hard "$rev"
  git -C "$dir" clean -qfdx
  echo 1
}

case $(sync_branch "$HOME/SuperBot/web-dist" web-dist) in
  1) echo "web-dist updated; it is served from a read-only mount, so nothing restarts" ;;
  2) echo "web-dist branch not found; keeping the current web build" >&2 ;;
esac

server_changed=0
case $(sync_branch "$HOME/SuperBot/server-dist" server-dist) in
  1)
    test -f "$HOME/SuperBot/server-dist/index.js" && test -f "$HOME/SuperBot/server-dist/cloud-home-start.js" \
      || { echo "server-dist has no compiled bundle; not restarting omb" >&2; exit 1; }
    server_changed=1 ;;
  2) echo "server-dist branch not found yet; updating the web build only" >&2 ;;
esac

[ "$server_changed" = 1 ] || { echo "server-dist unchanged; omb and caddy keep running"; exit 0; }

chmod -R a-w "$HOME/SuperBot/server-dist"
# Never switch the app to a bundle that fails its compiled self-check. index.js boots the whole server on import, so it is only syntax-checked.
$C run -T --rm --no-deps --entrypoint sh omb -c 'test ! -w /app/dist-server && timeout 60 node --check /app/dist-server/index.js && timeout 60 node -e "import(\"/app/dist-server/cloud-home-start.js\").catch((e) => { console.error(e); process.exit(3); })" || exit 3' || rc=$?
if [ "${rc:-0}" -ne 0 ]; then echo "Compiled server validation failed ${rc}" >&2; chmod -R u+w "$HOME/SuperBot/server-dist"; exit "$rc"; fi
# Compose leaves a container whose config is unchanged running, and server-dist is a bind mount, so only
# --force-recreate swaps in the new bundle. Caddy joins omb's network namespace (network_mode: service:omb),
# so it must be recreated after every new omb or it stays in the old, dead namespace.
omb_id() { id=$($C ps -q omb) && [ -n "$id" ] && docker inspect --format '{{.Id}}' "$id"; }
before=$(omb_id || true)
timeout 300 $C up -d --no-deps --no-build --force-recreate omb
after=$(omb_id) || { echo "omb is not running after the update" >&2; exit 1; }
[ "$after" != "$before" ] || { echo "omb was not recreated; it still runs the previous server" >&2; exit 1; }
timeout 120 $C up -d --no-deps --no-build --force-recreate caddy
tries=0
until curl -fsS --max-time 5 http://127.0.0.1:8080/api/health | grep -q '"openmausbot"'; do
  tries=$((tries + 1))
  [ "$tries" -lt 20 ] || { echo "the app does not answer its health check on 127.0.0.1:8080" >&2; exit 1; }
  sleep 3
done
echo "omb and caddy are up"
