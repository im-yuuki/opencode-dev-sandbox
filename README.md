# OpenCode Dev Sandbox

A full Linux dev box in one container, reachable from a browser. Coding agent, VS Code, an LXQt
desktop and a file manager — one HTTPS port, one login.

<p align="center">
  <img src="https://cdn.simpleicons.org/debian/A81D33" height="34" alt="Debian" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/docker/2496ED" height="34" alt="Docker" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/qt/41CD52" height="34" alt="LXQt" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/nodedotjs/5FA04E" height="34" alt="Node.js" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/python/3776AB" height="34" alt="Python" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/googlechrome/4285F4" height="34" alt="Chrome" />
</p>

---

## Quick start

```bash
docker run -d --name devbox \
  --security-opt seccomp=unconfined \
  -p 8080:9080 \
  -v devbox-workspace:/workspace \
  --tmpfs /tmp --shm-size=1g \
  ghcr.io/im-yuuki/opencode-dev-sandbox:latest
```

Docker Hub mirror:

```bash
docker run -d --name devbox \
  --security-opt seccomp=unconfined \
  -p 8080:9080 \
  -v devbox-workspace:/workspace \
  --tmpfs /tmp --shm-size=1g \
  imyuuki/opencode-dev-sandbox:latest
```

Then open **<https://localhost:8080/launcher/>**.

- Self-signed certificate on first boot — accept the browser warning once.
- First visit shows a password-setup form. Pick your password; that becomes your login.
- Any free host port works: `-p 12345:9080`.
- `linux/amd64` and `linux/arm64` images are published.

> **Security:** this image does not include a container daemon, mount the host Docker socket, or
> request unrestricted host privileges. The seccomp exception allows Chrome to create its renderer
> sandbox. It widens the available syscall surface, so never publish the port to an untrusted
> network. See [Chrome sandbox](#chrome-sandbox) below.

Get a shell:

```bash
docker exec -it devbox bash -lc 'su - user'
```

---

## Features

- **One login, one port.** Every tool sits behind a single HTTPS gateway with a PAM-backed
  session. No per-tool passwords, no extra ports to publish.
- **Launcher dashboard.** Start and stop apps from the browser; open them embedded or in a new
  tab.
- **Apps stay where you left them.** Enabled apps are remembered and restarted automatically
  after `docker restart`.
- **Persistent workspace.** `/workspace` is a volume: code, settings, desktop session and the
  TLS certificate survive container rebuilds.
- **Real desktop.** LXQt over noVNC, resolution follows your browser window.
- **Batteries included.** Node.js LTS, Python, a C/C++ toolchain, Git and Chrome preinstalled.
- **Multi-arch.** Runs natively on x86 and ARM (Apple Silicon, Raspberry Pi–class servers).

### Apps in the dashboard

| App | What it does |
| --- | --- |
| **Agent** | OpenCode sessions, diffs, git, terminal, editor. Always on. |
| **Code** | VS Code in the browser, rooted at `/workspace`. |
| **Desktop** | LXQt session streamed to the browser. |
| **Files** | Upload, download, archive, edit, move files. |

---

## Screenshots

| Dashboard | Agent |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Agent](docs/screenshots/agent.png) |

| Code | Files |
| --- | --- |
| ![Code](docs/screenshots/code.png) | ![Files](docs/screenshots/files.png) |

---

## Pre-installed

### Applications

| | App | What for |
| --- | --- | --- |
| <img src="https://cdn.simpleicons.org/opencode/000000/FFFFFF" height="20" /> | [OpenCode](https://opencode.ai) | Terminal-native coding agent |
| <img src="https://cdn.simpleicons.org/github/181717/FFFFFF" height="20" /> | [OpenChamber](https://github.com/openchamber/openchamber) | Web UI for agent sessions |
| <img src="https://cdn.simpleicons.org/coder/000000/FFFFFF" height="20" /> | [code-server](https://github.com/coder/code-server) | VS Code in the browser |
| <img src="https://cdn.simpleicons.org/qt/41CD52" height="20" /> | [LXQt](https://lxqt-project.org) | Desktop (Openbox), PCManFM-Qt, QTerminal, FeatherPad, LXQt Configuration Center |
| <img src="https://cdn.simpleicons.org/nodedotjs/5FA04E" height="20" /> | [Cloud Commander](https://cloudcmd.io) | Web file manager |
| <img src="https://cdn.simpleicons.org/googlechrome/4285F4" height="20" /> | [Google Chrome](https://www.google.com/chrome/) | Browser on the desktop, with its own sandbox |
| <img src="https://cdn.simpleicons.org/xdotorg/F28834" height="20" /> | [TigerVNC + noVNC](https://novnc.com) | Desktop streaming |
| <img src="https://cdn.simpleicons.org/nginx/009639" height="20" /> | [nginx](https://nginx.org) | HTTPS gateway |

### Toolchain

| | Tool | Homepage |
| --- | --- | --- |
| <img src="https://cdn.simpleicons.org/nodedotjs/5FA04E" height="20" /> | Node.js LTS + npm | [nodejs.org](https://nodejs.org) |
| <img src="https://cdn.simpleicons.org/python/3776AB" height="20" /> | Python 3 + pip + venv | [python.org](https://www.python.org) |
| <img src="https://cdn.simpleicons.org/gnu/A42E2B" height="20" /> | build-essential (gcc/g++/make) | [gcc.gnu.org](https://gcc.gnu.org) |
| <img src="https://cdn.simpleicons.org/cmake/064F8C" height="20" /> | CMake | [cmake.org](https://cmake.org) |
| <img src="https://cdn.simpleicons.org/git/F05032" height="20" /> | Git | [git-scm.com](https://git-scm.com) |
| <img src="https://cdn.simpleicons.org/vim/019733" height="20" /> | Vim | [vim.org](https://www.vim.org) |
| <img src="https://cdn.simpleicons.org/htop/009900" height="20" /> | htop | [htop.dev](https://htop.dev) |
| <img src="https://cdn.simpleicons.org/curl/073551" height="20" /> | curl / wget | [curl.se](https://curl.se) |
| <img src="https://cdn.simpleicons.org/7zip/000000/FFFFFF" height="20" /> | zip, unzip, p7zip, jq | [7-zip.org](https://www.7-zip.org) |

---

## Usage notes

### Custom hostname or LAN address in the certificate

Set extra SANs on first boot:

```bash
-e TLS_SAN="DNS:devbox.lan,IP:192.168.1.10"
```

Only read when the certificate does not exist yet. To regenerate, delete
`/workspace/.devbox/tls` and restart the container. You can also drop your own
`devbox.crt` / `devbox.key` in that directory.

### Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `WEB_USER` | `user` | Account name inside the container |
| `TLS_SAN` | — | Extra SANs for the generated certificate |

### Chrome sandbox

Chrome's renderer sandbox creates an unprivileged user namespace. Docker's default seccomp
profile blocks that operation, so the quick start uses `seccomp=unconfined`. The container still
receives no host devices, host namespaces, host socket, or host-level capabilities.

At boot the image probes `unshare -Ur`. If it is unavailable, Chrome starts with `--no-sandbox`
rather than failing silently. This reduces browser defense in depth; use the quick-start setting
when the desktop browser is exposed to untrusted web content.

If the probe fails despite the seccomp setting, the host may disallow unprivileged user
namespaces:

```bash
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

Recent Ubuntu hosts can additionally restrict unprivileged user namespaces through AppArmor:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

These are host-wide settings; evaluate them against your threat model before changing them.

### Ports

Internal services live on 9080 and 9100–9104, so dev servers you run inside the box (3000,
5173, 8080, …) never collide.

---

## Build from source

```bash
git clone https://github.com/im-yuuki/opencode-dev-sandbox.git
cd opencode-dev-sandbox
docker build -t devbox .
```
