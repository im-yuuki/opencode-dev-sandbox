# OpenCode Dev Sandbox

A full Linux dev box in one container, reachable from a browser. Coding agent, persistent multi-tab
web terminal, VS Code, an LXQt desktop, a file manager and an LLM proxy — plaintext HTTP or
self-signed HTTPS, one login.

<p align="center">
  <img src="https://cdn.simpleicons.org/debian/A81D33" height="34" alt="Debian" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/docker/2496ED" height="34" alt="Docker" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/qt/41CD52" height="34" alt="LXQt" />
  &nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/nixos/5277C3" height="34" alt="Nix" />
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
docker run -d --security-opt seccomp=unconfined --tmpfs /tmp --shm-size=1g -p 8080:80 -p 8443:443 --name devbox -v devbox-workspace:/workspace ghcr.io/im-yuuki/opencode-dev-sandbox:latest
```

Docker Hub mirror:

```bash
docker run -d --security-opt seccomp=unconfined --tmpfs /tmp --shm-size=1g -p 8080:80 -p 8443:443 --name devbox -v devbox-workspace:/workspace imyuuki/opencode-dev-sandbox:latest
```

Then open either **<http://localhost:8080/launcher/>** or **<https://localhost:8443/launcher/>**.

- Self-signed certificate on first boot — accept the browser warning once.
- First visit shows a password-setup form. Pick your password; that becomes your login **and** the
  Unix password of the `user` account, so `sudo` uses it too.
- Any free host ports work, for example `-p 12345:80 -p 12346:443`.
- `linux/amd64` and `linux/arm64` images are published.

> [!CAUTION]
> This is a trusted single-user dev box. Everything you run in it — agent, desktop, editor, file
> manager, proxy — runs as the same account, and the password you set can become root inside the
> container. The image does not include a container daemon, mount the host Docker socket, or
> request unrestricted host privileges, but never publish the ports to an untrusted network. See
> [Security model](docs/security.md).

Get a shell:

```bash
docker exec -it -u user devbox devbox-user-env bash
```

`devbox-user-env` is the same wrapper the supervised apps run under, so the shell gets the Nix
profile and state directories the apps use. A plain `su - user` works too, but a login shell resets
`PATH` and drops the Nix profile.

---

## Features

- **One login, one port.** Every tool sits behind a single HTTPS gateway with a PAM-backed
  session. No per-tool passwords, no extra ports to publish.
- **Launcher dashboard.** Start and stop apps from the browser. Every web UI opens in a new tab;
  there is no embedded/iframe view.
- **Persistent web terminal.** Open multiple terminal tabs in one browser tab. Closing the browser
  or losing the network detaches the WebSocket only; tmux keeps the shell and its processes running.
  Reopen Terminal to reconnect by session ID; use **Kill** when a session should actually stop.
- **Apps stay where you left them.** Enabled apps are remembered and restarted automatically
  after `docker restart`.
- **Persistent workspace.** `/workspace` is a volume: code, settings, desktop session, secrets and
  the TLS certificate survive container rebuilds.
- **Real desktop.** LXQt over noVNC, resolution follows your browser window.
- **Real sudo.** Standard `/usr/bin/sudo` with your Unix password. No passwordless drop-in, no
  shim.
- **Nix for the rest.** Single-user Nix, no daemon and no sudo needed to install packages —
  compilers, CMake and anything else per project.
- **Batteries included.** Node.js LTS, Python, Git, Chrome and a wide set of Linux CLI tools
  preinstalled.
- **Multi-arch.** Runs natively on x86 and ARM (Apple Silicon, Raspberry Pi–class servers).

---

## Pre-installed

### Applications

| # | App | What for |
| --- | --- | --- |
| <img src="https://cdn.simpleicons.org/opencode/000000/FFFFFF" height="20" /> | [OpenCode](https://opencode.ai) | Terminal-native coding agent |
| <img src="https://cdn.simpleicons.org/gnubash/4EAA25" height="20" /> | Persistent web terminal | Multiple reconnectable tmux sessions in one browser tab |
| <img src="https://cdn.simpleicons.org/github/181717/FFFFFF" height="20" /> | [OpenChamber](https://github.com/openchamber/openchamber) | Web UI for agent sessions |
| <img src="https://cdn.simpleicons.org/coder/000000/FFFFFF" height="20" /> | [code-server](https://github.com/coder/code-server) | VS Code in the browser |
| <img src="https://cdn.simpleicons.org/qt/41CD52" height="20" /> | [LXQt](https://lxqt-project.org) | Desktop (Openbox), PCManFM-Qt, QTerminal, FeatherPad, LXQt Configuration Center |
| <img src="https://cdn.simpleicons.org/files/4285F4" height="20" /> | [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser) | Web file manager |
| <img src="https://cdn.simpleicons.org/github/181717/FFFFFF" height="20" /> | [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) + [Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) | OpenAI-compatible proxy for provider accounts |
| <img src="https://cdn.simpleicons.org/googlechrome/4285F4" height="20" /> | [Google Chrome](https://www.google.com/chrome/) | Browser on the desktop, with its own sandbox |
| <img src="https://cdn.simpleicons.org/xdotorg/F28834" height="20" /> | [TigerVNC + noVNC](https://novnc.com) | Desktop streaming |
| <img src="https://cdn.simpleicons.org/nginx/009639" height="20" /> | [nginx](https://nginx.org) | HTTPS gateway |

### Runtimes and package management

| # | Tool | Homepage |
| --- | --- | --- |
| <img src="https://cdn.simpleicons.org/nodedotjs/5FA04E" height="20" /> | Node.js LTS + npm | [nodejs.org](https://nodejs.org) |
| <img src="https://cdn.simpleicons.org/python/3776AB" height="20" /> | Python 3 + pip + venv | [python.org](https://www.python.org) |
| <img src="https://cdn.simpleicons.org/nixos/5277C3" height="20" /> | Nix (single-user, flakes enabled) | [nixos.org](https://nixos.org) |
| <img src="https://cdn.simpleicons.org/git/F05032" height="20" /> | Git | [git-scm.com](https://git-scm.com) |

No C/C++ toolchain and no CMake ship in the image. Install them per project with Nix — see
[usage](docs/usage.md#nix).

### CLI tools

| Category | Tools |
| --- | --- |
| Shell | bash-completion, less, file, tree, coreutils, findutils, grep, sed, gawk, diffutils, patch |
| Search and view | ripgrep, fd (`fdfind`), fzf, bat (`batcat`), eza, jq, sqlite3 |
| Editors | vim, nano |
| Archives | tar, gzip, bzip2, xz, zstd, zip, unzip, 7zip, rsync |
| Process and system | procps, psmisc, util-linux, lsof, htop, btop, fastfetch |
| Inspect and debug | strace, ltrace, time, binutils, xxd, binwalk |
| Network | aria2, curl, wget, openssh-client, gnupg, iproute2, ping, dig, netcat, socat, traceroute, mtr, whois, iperf3, nmap, tcpdump, cloudflared |

`fd` and `bat` keep Debian's renamed binaries; the managed shell setup aliases the short names.
Some `tcpdump`, `nmap` and low-level networking operations still depend on Linux capabilities the
container runtime grants — the image never asks for privileged mode.

---

## Screenshots

| Dashboard | Agent |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Agent](docs/screenshots/agent.png) |

| Code | Files |
| --- | --- |
| ![Code](docs/screenshots/code.png) | ![Files](docs/screenshots/files.png) |

---

## Documentation

- [Usage notes](docs/usage.md) — sudo, Nix, CLI proxy, OpenCode configuration, TLS, Chrome
  sandbox, ports.
- [Security model](docs/security.md) — trust boundary, secrets, what not to expose.

---

## Build from source

```bash
git clone https://github.com/im-yuuki/opencode-dev-sandbox.git
cd opencode-dev-sandbox
docker build -t devbox .
```
