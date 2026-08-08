# DevBox

Debian Trixie container with supervisord as PID1 (no systemd), KDE Plasma 6 over
noVNC, VS Code web, OpenChamber/opencode, and Docker-in-Docker. Everything
reachable through a single HTTP port behind one PAM-backed login.

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
| `/code/`              | VS Code web (code-server) | nginx auth_request         |
| `/api/`               | control plane (PAM)   | session cookie                |

The dashboard toggles supervised services (stop/start/restart) and links tools;
the VNC server itself uses `SecurityTypes=None` and binds only to loopback. The
container's only published port is `8080`.

Services are grouped by user-facing feature (`/api/v1/services` returns groups);
a group action applies to all of its programs, so paired features stay consistent —
e.g. Desktop (Plasma) toggles `vnc` (Xvnc + Plasma) together with its
`websockify` noVNC bridge. `nginx` (gateway) and the control plane are
protected: the UI cannot stop them, and the API rejects it with 403, because
shutting the gateway/auth down locks everyone out of the box.

## Process model

`supervisord` runs as PID 1 (started by `scripts/entrypoint.sh` after it seeds
the workspace) and supervises one program per service under
`/etc/supervisor/conf.d/`. Child stdout/stderr go to `/dev/stdout`, so
`docker logs` shows everything. There is no systemd: no `systemctl`, no
`journalctl`, no cgroup bookkeeping in the container.

## Run manually

```bash
docker run -d --name devbox \
  --privileged \
  -p 8080:8080 \
  -v devbox-workspace:/workspace \
  --tmpfs /tmp \
  -e WEB_USER=user \
  devbox
```

`--privileged` is needed only for the nested `dockerd` (it creates containers
and manages iptables); the control plane and all other services run
unprivileged in the container. The container still has full access to the host
kernel, so treat it as trusted-workload-only and do not expose port 8080 to an
untrusted network.

## The `user` account

- uid 1000, home `/workspace`, shell `/bin/bash`
- groups `sudo` (NOPASSWD via `/etc/sudoers.d/99-nopasswd`) and `docker`
- created locked; password is chosen on first visit via `/ui/setup`
  (PAM + `chpasswd`), which also seeds the session cookie

Get a shell:

```bash
./scripts/run.sh sh          # or: docker exec -it devbox su - user
```

## Frontend source

Dashboard/auth UI source lives in `web/` (Vite + React + TypeScript + HeroUI v3 + Tailwind
v4 + lucide-react + Framer Motion). The Dockerfile builds it in an independent Node builder
stage and copies only `web/dist` into the final image.

```bash
cd web
npm ci
npm run dev       # local Vite server
npm run lint
npm run build     # tsc -b && vite build
```

## Docker-in-Docker

`dockerd` runs as a supervised program, listening on `unix:///var/run/docker.sock`
(no TCP listener). `user` is in the `docker` group, so no sudo needed:

```bash
docker run --rm hello-world
docker compose version      # v2 plugin
```

## Preinstalled

- git, curl, wget, vim, htop, jq, zip/unzip, p7zip
- build-essential (gcc/g++/make), cmake
- python3 + pip + venv + `python3-pamela` (PAM backend)
- Node.js latest LTS + npm (NodeSource apt repo, major resolved from `setup_lts.x` at build time)
- docker-ce, docker-ce-cli, containerd, docker-compose-plugin
- `opencode`, `openchamber`
- `code-server` (VS Code web; prebuilt static tarball — the npm package breaks
  on arm64, argon2 needs node-gyp against the distro node)
- KDE: plasma-desktop, kwin-x11, dolphin, konsole, systemsettings, kate
- google-chrome-stable (Google's apt repo; amd64 + arm64)

## Services

| Program       | Port           | Notes                                |
| ------------- | -------------- | ------------------------------------ |
| `docker`      | unix sock     | DinD (vfs storage driver)            |
| `vnc`         | 5901           | Xvnc + Plasma, runs as `user`        |
| `websockify`  | 6080           | noVNC static + WS bridge → 5901      |
| `openchamber` | 3000 (loopback) | no `--lan`; nginx PAM-gates it     |
| `code-server` | 3001 (loopback) | VS Code web, routed `/code/`      |
| `devbox-api`  | 3100 (loopback) | control plane: PAM, sessions, supervisor |
| `nginx`       | 8080           | published gateway                    |
| `dbus`        | —              | system message bus (infrastructure)  |

Inspect them the usual way:

```bash
docker exec -it devbox supervisorctl status
docker exec -it devbox supervisorctl status vnc
docker logs -f devbox
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

Screen size lives in `scripts/vnc-run.sh` (`-geometry 1600x1000`).
