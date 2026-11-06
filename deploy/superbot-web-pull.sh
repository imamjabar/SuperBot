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
  1) changed=1 ;;
  2) echo "web-dist branch not found; keeping the current web build" >&2 ;;
esac

case $(sync_branch "$HOME/SuperBot/server-dist" server-dist) in
  1)
    test -f "$HOME/SuperBot/server-dist/index.js" && test -f "$HOME/SuperBot/server-dist/cloud-home-start.js" \
      || { echo "server-dist has no compiled bundle; not restarting omb" >&2; exit 1; }
    changed=1 ;;
  2) echo "server-dist branch not found yet; updating the web build only" >&2 ;;
esac

[ "$changed" = 1 ] || { echo "web-dist and server-dist unchanged"; exit 0; }
# compose.override.yaml mounts server-dist over /app/dist-server, so an empty checkout would leave omb without a server.
test -f "$HOME/SuperBot/server-dist/index.js" \
  || { echo "server-dist has no bundle yet; run again after CI publishes it, omb not recreated" >&2; exit 0; }

chmod -R a-w "$HOME/SuperBot/server-dist"
# Never switch the app to a bundle that fails its compiled self-check. index.js boots the whole server on import, so it is only syntax-checked.
$C run -T --rm --no-deps --entrypoint sh omb -c 'test ! -w /app/dist-server && timeout 60 node --check /app/dist-server/index.js && timeout 60 node -e "import(\"/app/dist-server/cloud-home-start.js\").catch((e) => { console.error(e); process.exit(3); })" || exit 3' || rc=$?
if [ "${rc:-0}" -ne 0 ]; then echo "Compiled server validation failed ${rc}" >&2; chmod -R u+w "$HOME/SuperBot/server-dist"; exit "$rc"; fi
$C up -d --no-build omb
$C up -d --force-recreate caddy
curl -fsS --retry 5 --retry-delay 3 http://127.0.0.1:8080/api/health
