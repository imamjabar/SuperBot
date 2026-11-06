# Shared desktop on the VPS

`docker-compose.computer.yml` stacks after the VPS's `compose.yaml` and
`compose.override.yaml`. It changes only `omb`:

- mounts the host Docker CLI and socket, and adds the host's `docker` group
  (`group_add: ["113"]`) so the app user can use the socket. Replace `113` with
  the output of `getent group docker | cut -d: -f3` on your host;
- keeps the named volume `superbot_data` on `/data` (declared `external`, so
  Compose never creates or removes it) and also mounts its host path
  `/var/lib/docker/volumes/superbot_data/_data` on `/host-data`;
- sets `OMB_DATA_DIR=/host-data/.openmausbot`. This is the same files as
  `/data/.openmausbot`, so no data moves. The host Docker daemon resolves the
  desktop's bind mount of `vm-home` from that path, and the path exists on
  the host as well as in the container;
- pins `OMB_LOCAL_VM_IMAGE` to the desktop image that CI built.

It publishes no ports, mounts no Caddy socket, carries no secrets and builds nothing.

Run everything from the VPS deploy directory. Below, `$C` and `$H` are:

```sh
C="docker compose -p superbot -f compose.yaml -f compose.override.yaml -f docker-compose.computer.yml"
H=/var/lib/docker/volumes/superbot_data/_data/.openmausbot
```

## Deploy

1. Back up the config and the compose files. Keep `vm-home` as it is.

   ```sh
   S=bak-20261106-task2
   cp $H/config.json $H/config.json.$S
   cp compose.yaml compose.yaml.$S; cp compose.override.yaml compose.override.yaml.$S
   ```

2. Merge `localVm` into `$H/config.json`. Keep every other key.

   ```json
   "localVm": { "mode": "shared", "maxInstances": 1, "idleTimeoutMinutes": 15, "preserveInstalledApps": false }
   ```

3. Create the desktop workspace on the host. The desktop runs as uid 1000.

   ```sh
   mkdir -p $H/vm-home && chown 1000:1000 $H/vm-home
   ```

4. Pull the image on the host, then recreate `omb` and Caddy:

   ```sh
   docker pull ghcr.io/imamjabar/superbot-computer@sha256:d7894c2788e22312a6ab443a09ad7cce700748c8e9a57a7c53a9b6cc6d625b77
   $C up -d --no-build omb
   $C up -d --no-build --force-recreate caddy
   ```

5. Every script that recreates `omb`, including `web-pull.sh`, must pass all
   three `-f` files as in `$C`. If it does not, `omb` loses access to Docker and
   the desktop.

Let the app start the desktop (from the UI or API). If you create
`openmausbot-computer` by hand, restart `omb` so that it finds the container.

## Checks

- **Start:** open a bot that uses the computer and start the desktop. On the
  host, `docker ps --filter name=openmausbot-computer` shows one container.
- **Screenshot:** ask the bot for a screenshot. The reply has an image.
- **Visible Chrome:** ask the bot to open a page in Chrome. The desktop viewer
  shows the Chrome window.
- **Idle:** leave the desktop for more than 15 minutes. After that,
  `docker ps -a --filter name=openmausbot-computer` shows `Exited`, and the app
  shows the desktop as stopped because it was idle.
- **RAM:** `docker stats --no-stream openmausbot-computer` stays under its 4 GiB
  limit, and `free -h` shows that the host still has free memory.

## Rollback

```sh
docker stop openmausbot-computer; docker rm openmausbot-computer
S=bak-20261106-task2
cp $H/config.json.$S $H/config.json
cp compose.yaml.$S compose.yaml; cp compose.override.yaml.$S compose.override.yaml
C="docker compose -p superbot -f compose.yaml -f compose.override.yaml"
$C up -d --no-build --force-recreate omb
$C up -d --no-build --force-recreate caddy
```

Remove only `openmausbot-computer`. Do not remove volumes or `/data`, so
`vm-home` and all other data stay.
