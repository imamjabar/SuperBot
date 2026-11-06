# Shared desktop on the VPS

`docker-compose.computer.yml` stacks after the VPS's `compose.yaml` and
`compose.override.yaml`. It changes only `omb`: it mounts the host Docker CLI and
socket, and pins `OMB_LOCAL_VM_IMAGE` to the desktop image that CI built. It
publishes no ports, mounts no Caddy socket, carries no secrets and builds nothing.

Run everything from the VPS deploy directory. Below, `$C` is:

```sh
C="docker compose -p superbot -f compose.yaml -f compose.override.yaml -f docker-compose.computer.yml"
```

## Deploy

1. Back up the config and the compose files. Keep `data/vm-home` as it is.

   ```sh
   S=bak-20261106-task2
   $C exec omb cp /data/.openmausbot/config.json /data/.openmausbot/config.json.$S
   cp compose.yaml compose.yaml.$S; cp compose.override.yaml compose.override.yaml.$S
   ```

2. Merge `localVm` into `/data/.openmausbot/config.json`. Keep every other key.

   ```json
   "localVm": { "mode": "shared", "maxInstances": 1, "idleTimeoutMinutes": 15, "preserveInstalledApps": false }
   ```

3. Pull the image on the host, then recreate `omb` and Caddy:

   ```sh
   docker pull ghcr.io/imamjabar/superbot-computer@sha256:d7894c2788e22312a6ab443a09ad7cce700748c8e9a57a7c53a9b6cc6d625b77
   $C up -d --no-build omb
   $C up -d --no-build --force-recreate caddy
   ```

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
$C exec omb cp /data/.openmausbot/config.json.$S /data/.openmausbot/config.json
C="docker compose -p superbot -f compose.yaml -f compose.override.yaml"
$C up -d --no-build --force-recreate omb
$C up -d --no-build --force-recreate caddy
```

Remove only `openmausbot-computer`. Do not remove volumes or `/data`, so
`data/vm-home` stays.
