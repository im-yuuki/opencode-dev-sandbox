# DevBox

Debian Trixie container with systemd, KDE Plasma 6 over noVNC, Cockpit (web admin +
terminal), OpenChamber/opencode, and Docker-in-Docker. Everything reachable through a
single HTTP port.

## Quick start

```bash
./scripts/run.sh build
WEB_PASSWORD='pick-something' ./scripts/run.sh run
```

Open <http://localhost:8080/start/> for the landing page.

| Path        | Service     | Auth                                   |
| ----------- | ----------- | -------------------------------------- |
| `/`         | OpenChamber | nginx basic-auth + OpenChamber password|
| `/start/`   | landing page (links to everything) | nginx basic-auth     |
| `/vnc/`     | KDE desktop | nginx basic-auth                        |
| `/terminal/`| web terminal (ttyd) | nginx basic-auth               |
| `/cockpit/` | Cockpit     | Cockpit's own login (`user` / password)|

The nginx/Cockpit/OpenChamber passwords all come from `WEB_PASSWORD` (default `changeme`).

The VNC server itself uses `SecurityTypes=None` and binds only to loopback: nginx is the
single auth boundary; the container's only published port is `8080`.

## Run manually

```bash
docker run -d --name devbox \
  --privileged --cgroupns=host \
  -p 8080:8080 \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v devbox-workspace:/workspace \
  --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
  -e WEB_PASSWORD=pick-something \
  devbox
```

`--privileged` is required twice over: systemd needs it to boot as PID 1, and the nested
`dockerd` needs it to create containers. The container has full access to the host kernel,
so treat it as trusted-workload-only and do not expose port 8080 to an untrusted network.

## The `user` account

- uid 1000, home `/workspace`, shell `/bin/bash`
- groups `sudo` (NOPASSWD via `/etc/sudoers.d/99-nopasswd`) and `docker`
- password set from `WEB_PASSWORD` so Cockpit login works

Get a shell:

```bash
./scripts/run.sh sh          # or: docker exec -it devbox su - user
```

## Docker-in-Docker

`dockerd` runs as a systemd service, listening on `unix:///var/run/docker.sock` and
`tcp://0.0.0.0:2375` (container-local). `user` is in the `docker` group, so no sudo needed:

```bash
docker run --rm hello-world
docker compose version      # v2 plugin
```

Port 2375 is unauthenticated. It is not published by `scripts/run.sh`; keep it that way unless you
add TLS.

## Preinstalled

- git, curl, wget, vim, htop, jq, zip/unzip, p7zip
- build-essential (gcc/g++/make), cmake
- python3 + pip + venv
- Node.js 22 (NodeSource)
- docker-ce, docker-ce-cli, containerd, docker-compose-plugin
- `opencode`, `openchamber`
- KDE: plasma-desktop, kwin-x11, dolphin, konsole

## Services

| Unit                  | Port           | Notes                                |
| --------------------- | -------------- | ------------------------------------ |
| `docker.service`      | 2375, unix sock| DinD                                 |
| `vnc.service`         | 5901           | Xvnc + Plasma, runs as `user`        |
| `websockify.service`  | 6080           | serves noVNC static + WS bridge      |
| `cockpit.socket`      | 9090           | `UrlRoot=/cockpit/`                  |
| `openchamber.service` | 3000           | `--lan`, UI password from env file   |
| `ttyd.service`        | 7681 (loopback) | web terminal, routed `/terminal/`  |
| `nginx.service`       | 8080           | published gateway                    |

Inspect them the usual way:

```bash
docker exec -it devbox systemctl status vnc.service
docker exec -it devbox journalctl -u openchamber -f
```

## Persistence

`/workspace` is a volume. On boot the entrypoint reseeds the desktop session script
(`~/.config/tigervnc/xstartup`), KDE locker/power settings, and `~/.bashrc` if they are
missing, so mounting an empty volume still gives a working desktop session.

## Configuration

| Env var        | Default     | Effect                                     |
| -------------- | ----------- | ------------------------------------------ |
| `WEB_USER`     | `user`      | account name and basic-auth user           |
| `WEB_PASSWORD` | `changeme`  | basic-auth, VNC, Cockpit, OpenChamber      |

Screen size lives in `etc/systemd/system/vnc.service` (`-geometry 1600x1000`).
