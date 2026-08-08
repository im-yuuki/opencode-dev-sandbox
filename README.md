# DevBox

Debian Trixie container with supervisord as PID1 (no systemd), KDE Plasma 6 over
noVNC, VS Code web, OpenChamber/opencode, and Docker-in-Docker. Everything
reachable through a single HTTP port behind one PAM-backed login.

## Quick start

```bash
./scripts/run.sh build
./scripts/run.sh run
```

Open <http://localhost:8080/launcher/> (8080 is `run.sh`'s default host port;
override with `PORT=… ./scripts/run.sh run`). First visit: the login page shows
the password-setup form directly (Linux PAM against the container account).

| Path                  | Service               | Auth                          |
| --------------------- | --------------------- | ----------------------------- |
| `/launcher/`          | login/dashboard SPA   | session cookie (PAM)          |
| `/launcher/embed/:tool` | iframe view of a tool | session cookie              |
| `/launcher/api/`      | control plane (PAM)   | session cookie                |
| `/`                   | OpenChamber           | nginx auth_request (session)  |
| `/vnc/`               | KDE desktop (noVNC)   | nginx auth_request            |
| `/code/`              | VS Code web (code-server) | nginx auth_request         |

The control plane lives under `/launcher/api` (nginx strips the prefix; the
backend keeps serving `/api/v1/*`) so OpenChamber keeps its own `/api`
endpoints at the root. Legacy `/ui/…` bookmarks 301 to `/launcher/…`.

The dashboard shows the four user-facing *applications* — **Agent** (always on),
**Desktop**, **Code** and **Docker** — and toggles their supervised programs
(`/launcher/api/v1/services` returns them as `apps`). A toggle applies to all of
an app's programs, so paired features stay consistent — e.g. Desktop toggles
`vnc` (Xvnc + Plasma) together with its `websockify` noVNC bridge. Everything
except Agent starts stopped; **Launching an app persists it** (state file in
`/workspace/.devbox/apps.json`), so it comes back after a container restart
until you Stop it. `nginx` (gateway) and the control plane are always on and
never listed: stopping the gateway locks everyone out of the box.

## Process model

`supervisord` runs as PID 1 (started by `scripts/entrypoint.sh` after it seeds
the workspace) and supervises one program per service under
`/etc/supervisor/conf.d/`. Child stdout/stderr go to `/dev/stdout`, so
`docker logs` shows everything. There is no systemd: no `systemctl`, no
`journalctl`, no cgroup bookkeeping in the container.

## Run manually

```bash
# Map any free host port to the container gateway (9080):
docker run -d --name devbox \
  --privileged \
  -p 8080:9080 \
  -v devbox-workspace:/workspace \
  --tmpfs /tmp \
  devbox
```

`-p` only chooses the published host port; nothing inside the box redirects to
port 9080, so any host port works (`-p 12345:9080`).

`--privileged` is needed only for the nested `dockerd` (it creates containers
and manages iptables); the control plane and all other services run
unprivileged in the container. The container still has full access to the host
kernel, so treat it as trusted-workload-only and do not expose the published
port to an untrusted network.

## The `user` account

- uid 1000, home `/workspace`, shell `/bin/bash`
- groups `sudo` (NOPASSWD via `/etc/sudoers.d/99-nopasswd`) and `docker`
- created locked; password is chosen on first visit: `/launcher/login` shows the
  setup form inline (PAM + `chpasswd`), which also seeds the session cookie

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

| Program       | App          | Port           | Notes                                |
| ------------- | ------------ | -------------- | ------------------------------------ |
| `openchamber` | Agent        | 9100 (loopback) | no `--lan`; nginx PAM-gates it; always on |
| `vnc`         | Desktop      | 5905           | Xvnc + Plasma (display :5), runs as `user` |
| `websockify`  | Desktop      | 9103           | noVNC static + WS bridge → 5905      |
| `code-server` | Code         | 9101 (loopback) | VS Code web, routed `/code/`      |
| `docker`      | Docker       | unix sock      | DinD (vfs storage driver)            |
| `devbox-api`  | —            | 9102 (loopback) | control plane: PAM, sessions, supervisor, app restore |
| `nginx`       | —            | 9080           | gateway; map any host port to it     |
| `dbus`        | —            | —              | system message bus (infrastructure)  |

Only `openchamber` autostarts (`autostart=true`). `vnc`, `websockify`,
`code-server` and `docker` have `autostart=false`: they start when the dashboard
launches them, and the control plane re-starts the persisted set on boot.

Internal services sit on high ports (9100–9103, nginx 9080, VNC 5905) so a dev
server you run inside the box (vite 5173, next/react 3000, spring 8080, …) never
collides with them.

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

The dashboard's enabled applications survive restarts too: the control plane
records them in `/workspace/.devbox/apps.json` and starts them again whenever it
boots, so `docker restart` (or `run.sh`'s rm + run on the same volume) keeps
your current set of apps running.

## Configuration

| Build arg       | Default                         | Effect                          |
| --------------- | ------------------------------- | ------------------------------- |
| `APT_MIRROR`    | `http://mirror.bizflycloud.vn/debian` | main Debian archive mirror (http; base image has no CA bundle yet). Security archive stays on deb.debian.org. |

| Env var   | Default | Effect                |
| --------- | ------- | --------------------- |
| `WEB_USER`| `user`  | account name          |

noVNC defaults to *remote* resize (`etc/novnc/defaults.json`), so the VNC
screen resolution follows the browser window; `-geometry 1600x1000` in
`scripts/vnc-run.sh` is only the initial size before a client connects.
