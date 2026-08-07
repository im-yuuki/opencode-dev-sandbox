# DevBox

Debian Trixie container with systemd, KDE Plasma 6 over noVNC, Cockpit (web admin +
terminal), OpenChamber/opencode, and Docker-in-Docker. Everything reachable through a
single HTTP port behind one PAM-backed login.

## Quick start

```bash
./scripts/run.sh build
./scripts/run.sh run
```

Open <http://localhost:8080/ui/>. First visit: set the account password at
`/ui/setup`, then log in at `/ui/login` (Linux PAM against the container account).

| Path                  | Service               | Auth                          |
| --------------------- | --------------------- | ----------------------------- |
| `/ui/`                | login/setup/dashboard SPA | session cookie (PAM)       |
| `/ui/embed/:tool`     | iframe view of a tool | session cookie                |
| `/`                   | OpenChamber           | nginx auth_request (session)  |
| `/vnc/`               | KDE desktop (noVNC)   | nginx auth_request            |
| `/terminal/`          | web terminal (ttyd)   | nginx auth_request            |
| `/cockpit/`           | Cockpit               | nginx auth_request + own login|
| `/api/`               | control plane (PAM)   | session cookie                |

The dashboard toggles systemd services (stop/start/restart) and links tools; the
VNC server itself uses `SecurityTypes=None` and binds only to loopback. The
container's only published port is `8080`.

## Run manually

```bash
docker run -d --name devbox \
  --privileged --cgroupns=host \
  -p 8080:8080 \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v devbox-workspace:/workspace \
  --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
  -e WEB_USER=user \
  devbox
```

`--privileged` is required twice over: systemd needs it to boot as PID 1, and the nested
`dockerd` needs it to create containers. The container has full access to the host kernel,
so treat it as trusted-workload-only and do not expose port 8080 to an untrusted network.

## The `user` account

- uid 1000, home `/workspace`, shell `/bin/bash`
- groups `sudo` (NOPASSWD via `/etc/sudoers.d/99-nopasswd`) and `docker`
- created locked; password is chosen on first visit via `/ui/setup`
  (PAM + `chpasswd`), which also seeds the session cookie
- Cockpit uses the same account/password (`user` / whatever was set)

Get a shell:

```bash
./scripts/run.sh sh          # or: docker exec -it devbox su - user
```

## Frontend source

Dashboard/auth UI source lives in `www/` (Vite + React + TypeScript + HeroUI + Tailwind
+ lucide-react + Framer Motion). The Dockerfile builds it in an independent Node builder
stage and copies only `www/dist` into the final image.

```bash
cd www
npm ci
npm run dev       # local Vite server
npm run typecheck
npm run build
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
- python3 + pip + venv + `python3-pamela` (PAM backend)
- Node.js 22 + npm (NodeSource apt repo)
- docker-ce, docker-ce-cli, containerd, docker-compose-plugin
- `opencode`, `openchamber`
- KDE: plasma-desktop, kwin-x11, dolphin, konsole

## Services

| Unit                  | Port           | Notes                                |
| --------------------- | -------------- | ------------------------------------ |
| `docker.service`      | 2375, unix sock| DinD (vfs storage driver)            |
| `vnc.service`         | 5901           | Xvnc + Plasma, runs as `user`        |
| `websockify.service`  | 6080           | noVNC static + WS bridge → 5901      |
| `cockpit.socket`      | 9090           | `UrlRoot=/cockpit/`                  |
| `openchamber.service` | 3000 (loopback) | no `--lan`; nginx PAM-gates it     |
| `ttyd.service`        | 7681 (loopback) | web terminal, routed `/terminal/`  |
| `devbox-api.service`  | 3100 (loopback) | control plane: PAM, sessions, systemd |
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

| Build arg       | Default                         | Effect                          |
| --------------- | ------------------------------- | ------------------------------- |
| `APT_MIRROR`    | `http://mirror.bizflycloud.vn/debian` | main Debian archive mirror (http; base image has no CA bundle yet). Security archive stays on deb.debian.org. |

| Env var   | Default | Effect                |
| --------- | ------- | --------------------- |
| `WEB_USER`| `user`  | account name          |

Screen size lives in `etc/systemd/system/vnc.service` (`-geometry 1600x1000`).