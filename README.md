# DevBox

Debian Trixie container with supervisord as PID1 (no systemd), KDE Plasma 6 over
noVNC, VS Code web, OpenChamber/opencode, and Docker-in-Docker. Everything
reachable through a single HTTPS port behind one PAM-backed login.

## Quick start

```bash
docker build -t devbox .
docker run -d --name devbox --privileged --security-opt seccomp=unconfined -p 8080:9080 -v devbox-workspace:/workspace --tmpfs /tmp devbox
```

Open <https://localhost:8080/launcher/> (8080 is the host port mapped to the
gateway's 9080; override with `-p <port>:9080`). The gateway is HTTPS with a
self-signed certificate generated on first boot, so the browser shows a warning
once — accept it. First visit: the login page shows the password-setup form
directly (Linux PAM against the container account).

`--security-opt seccomp=unconfined` is what lets Chrome start. Its zygote calls
`clone(CLONE_NEWUSER)`, which Docker's default seccomp profile blocks for
unprivileged processes — `--privileged` alone does not lift it, and Chrome dies
with `Failed to move to new namespace … Operation not permitted`. With the flag,
Chrome keeps its own sandbox instead of needing `--no-sandbox`. If it still
fails, the host disallows unprivileged user namespaces:

```bash
sysctl kernel.unprivileged_userns_clone        # Debian/Ubuntu hosts
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

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

## TLS

The gateway serves HTTPS only on 9080. On first boot `scripts/entrypoint.sh`
generates a self-signed RSA-2048 certificate (10 years, `CN=devbox`) into
`/workspace/.devbox/tls/{devbox.crt,devbox.key}` and nginx picks it up from
there. Because it lives on the `/workspace` volume, the pair — and the trust
exception you granted in the browser — survives `docker rm` and image rebuilds.
The key is root-owned `0600`.

Plain HTTP to the port gets nginx's 497, which is redirected to the same URL
over https, so an `http://…` bookmark still lands.

Default SANs cover `localhost`, the container hostname, `127.0.0.1` and `::1`.
To reach the box by another name or LAN address, add SANs at first boot and let
the cert regenerate:

```bash
docker run -d --name devbox --privileged -p 8080:9080 \
  -e TLS_SAN="DNS:devbox.lan,IP:192.168.1.10" \
  -v devbox-workspace:/workspace --tmpfs /tmp devbox
```

`TLS_SAN` is only read when a certificate is generated. To replace an existing
one, delete `/workspace/.devbox/tls` and restart the container. Bring your own
certificate by dropping `devbox.crt` / `devbox.key` in that directory instead;
the entrypoint leaves non-empty files alone. It is self-signed, so it stops
passive sniffing on the wire but proves nothing about identity — do not treat it
as a reason to expose the port more widely.

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
docker exec -it devbox bash -lc 'su - user'
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
| `nginx`       | —            | 9080 (https)   | gateway; map any host port to it     |
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
boots, so `docker restart` (or `docker rm -f` + `docker run` again on the same
volume) keeps your current set of apps running.

## Configuration

| Build arg       | Default                         | Effect                          |
| --------------- | ------------------------------- | ------------------------------- |
| `APT_MIRROR`    | `http://mirror.bizflycloud.vn/debian` | main Debian archive mirror (http; base image has no CA bundle yet). Security archive stays on deb.debian.org. |

| Env var   | Default | Effect                |
| --------- | ------- | --------------------- |
| `WEB_USER`| `user`  | account name          |
| `TLS_SAN` | —       | extra SANs for the generated certificate, e.g. `DNS:devbox.lan,IP:192.168.1.10`. Only read when the certificate does not exist yet. |

noVNC defaults to *remote* resize (`etc/novnc/defaults.json`), so the VNC
screen resolution follows the browser window; `-geometry 1600x1000` in
`scripts/vnc-run.sh` is only the initial size before a client connects.
