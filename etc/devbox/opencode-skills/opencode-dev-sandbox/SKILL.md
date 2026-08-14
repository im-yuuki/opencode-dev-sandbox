---
name: opencode-dev-sandbox
description: Use when an OpenCode agent works inside this Debian-based DevBox image, especially for runtime, Nix packages, bundled services, or image-specific troubleshooting.
---

# OpenCode DevBox Environment

Use this skill as the operating contract for work performed inside this image. The DevBox is a
trusted, single-user development environment inside a container. It has a Debian userland, but it
is not a normal full Debian host: service management, home directories, package installation, and
network exposure all follow the image rules below.

## Runtime contract

- The final image is based on `debian:trixie-slim` and is published for `linux/amd64` and
  `linux/arm64`. The default locale is `C.UTF-8` and the default timezone is `Etc/UTC`.
- Work in `/workspace`. It is both the working directory and the home directory of the runtime
  account `user` (uid 1000). The `/workspace` volume persists source code and user configuration.
- The normal agent and desktop applications run as `user`. Root-only infrastructure includes
  nginx, the control API, D-Bus, and supervisord. Do not assume that changing uid is harmless.
- PID 1 is `/usr/bin/supervisord`, not systemd. There is no usable `systemctl` workflow and no
  expectation that a service has a systemd unit.
- `sudo` is the real `/usr/bin/sudo`, not a wrapper. The first-run web setup assigns the Unix
  password; until setup is complete the account is locked. This is a trusted single-user box, so
  anything running as uid 1000 can access the other uid-1000 applications and their files.
- The image does not provide a container daemon or the host Docker socket. Do not design a task
  around Docker-in-Docker or host-level container access.
- Runtime directories such as `/run/user/1000` are recreated at boot. The Nix store and its state
  under `/nix` are not on the persistent `/workspace` volume.

## Included tools

The image already contains the following tools. Check `command -v <tool>` before assuming a tool
is missing.

- OpenCode is installed as the uid-1000 user-local `opencode`; OpenChamber is installed as the
  uid-1000 user-local `openchamber` and provides the browser agent UI. Their npm prefix is
  `/workspace/.local`, which is writable by the runtime account and is first on the managed PATH.
- Node.js LTS and npm are installed globally. Python 3 includes `pip`, `venv`, `aiohttp`, and
  `pamela`.
- Git, GNU core utilities, Bash completion, `less`, `file`, `tree`, `find`, `grep`, `sed`, `gawk`,
  `diff`, `procps`, `psmisc`, `util-linux`, `lsof`, `tmux`, `jq`, and `sqlite3` are available.
- Search and inspection tools include `ripgrep` (`rg`), Debian's `fdfind`, `fzf`, Debian's
  `batcat`, `eza`, `htop`, `btop`, `fastfetch`, `strace`, `ltrace`, `time`, `binutils`, `xxd`, and
  `binwalk`.
- Archive and transfer tools include `tar`, `gzip`, `bzip2`, `xz`, `zstd`, `zip`, `unzip`, `7z`,
  `rsync`, `aria2c`, `curl`, `wget`, and `openssh-client`.
- Network diagnostics include `ip`, `ping`, `dig`, `nc`, `socat`, `traceroute`, `mtr`, `whois`,
  `iperf3`, `nmap`, `tcpdump`, and `cloudflared`. Some low-level network operations still need
  capabilities from the container runtime.
- Google Chrome is available through `/usr/local/bin/google-chrome-stable`. The wrapper probes
  user-namespace support and adapts Chrome when the runtime blocks it. `code-server` is available
  through `/usr/local/bin/code-server`.
- No C or C++ compiler and no CMake are intentionally installed in the base image. Use Nix for
  those and for other packages not already provided.

In an interactive managed Bash shell, `fd` aliases to `fdfind` and `bat` aliases to `batcat`.
Scripts and non-interactive commands must use the Debian names directly. The managed shell setup
is `/etc/devbox/bashrc`.

## Package policy

Install project and system packages that are not already in the image with Nix. Do not edit the
Dockerfile, change the base image, add an APT repository, or run `apt-get install` to solve a
project dependency during an agent task. The image is intentionally kept stable; project-specific
toolchains belong in the project environment.

Use the least persistent Nix form that fits the task:

```bash
# Temporary tools for the current shell
nix shell nixpkgs#gcc nixpkgs#cmake

# A user profile tool needed across commands in this container
nix profile install nixpkgs#ripgrep

# A repository-defined environment
nix develop
```

Nix is single-user, has `nix-command` and flakes enabled, and does not use `nix-daemon`. The
runtime environment sets:

- `NIX_STATE_HOME=/nix/var/nix/user-state`
- `NIX_CACHE_HOME=/nix/var/nix/user-cache`
- `NPM_CONFIG_PREFIX=/workspace/.local`
- `NPM_CONFIG_CACHE=/workspace/.npm`
- `/workspace/.local/bin` first on `PATH`, followed by
  `/nix/var/nix/user-state/profiles/profile/bin`

Use `/usr/local/bin/devbox-user-env <command>` for a supervised user service or for a shell that
must reproduce the service environment. The interactive `/etc/devbox/bashrc` also exports the Nix
variables for uid 1000. A plain `su - user` resets `PATH` and can hide the profile. A profile
installed with Nix survives `docker restart` and stop/start, but it is lost when the container is
removed and recreated because `/nix` is not persistent. Commit `flake.nix` and `flake.lock` when a
project needs a reproducible environment. Nix derivations run without the extra build isolation
setting, so do not treat an untrusted derivation as harmless.

For language dependencies already described by a repository lockfile, follow that repository's
documented package manager after the required system tools are present. Do not turn a language
dependency into a base-image change.

## Services and local endpoints

nginx is the only public gateway and listens on container ports 80 and 443. The other services
bind to loopback and are normally started or stopped from the Launcher dashboard. Most user-facing
Supervisor programs have `autostart=false`; enabled applications are remembered in
`/workspace/.devbox/apps.json`.

| Service | Loopback endpoint | Gateway route or use |
| --- | --- | --- |
| OpenChamber / Agent | `127.0.0.1:9100` | `/` |
| code-server | `127.0.0.1:9101` | `/code/` |
| DevBox control API | `127.0.0.1:9102` | `/launcher/api/` |
| noVNC and websockify | `127.0.0.1:9103` | `/vnc/` |
| FileBrowser Quantum | `127.0.0.1:9104` | `/files/` |
| Persistent terminal broker | `127.0.0.1:9105` | `/terminal/api/` and `/terminal/ws/` |
| CLIProxyAPI | `127.0.0.1:8317` | Management routes only; `/v1/` stays internal |

The web terminal uses tmux sessions. Disconnecting a browser tab detaches from a session; it does
not stop the shell or its commands. Container recreation still ends those processes. The CLI proxy
endpoint used by OpenCode is `http://127.0.0.1:8317/v1`. Provider accounts and proxy keys must be
configured in the CLIProxyAPI Management Center before model calls can work.

The global OpenCode config is seeded once at `~/.config/opencode/opencode.jsonc`, which resolves to
`/workspace/.config/opencode/opencode.jsonc` for this account. It enables LSP, web/code search, the
`context7` and `chrome-devtools` MCP servers, and the `opencode-background-agents` and `opencode-pty`
plugins. The image-seeded skill files live below `~/.config/opencode/skills/`; the entrypoint only
creates a missing skill file and preserves a user's existing edit.

The MCP servers are launched with `npx`, so their first start may need network access and may be
slower than later starts. If an MCP server fails, check `npx`, DNS, outbound access, and the
service's own log before changing the image.

## Agent workflow

1. Start in `/workspace` and inspect the repository's own instructions, lockfiles, and existing
   scripts before adding files or packages.
2. Confirm the runtime assumptions when behavior is surprising:

   ```bash
   id
   printf 'HOME=%s\nPATH=%s\n' "$HOME" "$PATH"
   command -v opencode node python3 nix git
   ```

3. Prefer the tools already shipped in the image. Use Nix for missing project packages, and keep
   the package declaration with the project when reproducibility matters.
4. Keep service configuration loopback-only unless the task explicitly requires a gateway route.
   Never expose the CLI proxy's `/v1/` endpoint or the internal service ports through a new public
   listener.
5. Treat `/workspace/.devbox` as sensitive. It contains the CLI proxy management key, provider
   credentials, proxy keys, FileBrowser state, and the TLS private key. Do not print or commit
   those files.
6. Use the Launcher for normal service lifecycle operations. If a root-level diagnosis is needed,
   inspect Supervisor with `sudo supervisorctl -c /etc/supervisor/supervisord.conf status` after
   the account has been configured.

## Troubleshooting image differences

### `systemctl` or a service unit is unavailable

That is expected. PID 1 is supervisord. Check program names with:

```bash
sudo supervisorctl -c /etc/supervisor/supervisord.conf status
```

The user-facing program names are `openchamber`, `code-server`, `filebrowser`, `vnc`,
`websockify`, `web-terminal`, and `cliproxyapi`. Start or stop them from the Launcher when possible;
the Supervisor socket is root-only.

### A Nix-installed command is not found

Check that the command is running as uid 1000 and that the Nix profile is on `PATH`. Run it through
`devbox-user-env`, source `/etc/devbox/bashrc` in an interactive Bash shell, or use `nix shell` for
a temporary invocation. Do not copy store paths into `/usr/local/bin` and do not install a second
system package with APT.

### OpenCode cannot see global configuration or skills

Check `echo "$HOME"`. The expected home is `/workspace`, and the expected global config directory
is `/workspace/.config/opencode`. OpenCode reads global skills from
`~/.config/opencode/skills/<skill-name>/SKILL.md`. A workspace volume may contain an older user
config; the entrypoint intentionally does not overwrite an existing `opencode.jsonc`,
`opencode.json`, or skill file.

### A compiler or native build tool is missing

This is intentional. Use a Nix shell or the project's flake, for example
`nix shell nixpkgs#gcc nixpkgs#cmake`. Keep the toolchain in the project environment instead of
changing the image's APT layer.

### `fd`, `bat`, or a familiar command behaves differently

Debian installs these binaries as `fdfind` and `batcat`. The short aliases exist only in the
managed interactive shell. Use the full names in scripts and verify options with `--help` rather
than assuming a different distribution's package layout.

### A browser or desktop service fails

The recommended container run includes `--tmpfs /tmp` and `--shm-size=1g`; Chrome may also need
`--security-opt seccomp=unconfined` so its user-namespace probe succeeds. The entrypoint records the
probe in `/run/devbox/caps` and the Chrome wrapper adapts if user namespaces are unavailable. Check
the `vnc`, `websockify`, and `code-server` Supervisor logs and confirm that `/run/user/1000` exists.

### A port is already in use

Keep development servers on ordinary project ports such as 3000, 5173, or 8080. Do not bind to
9100-9105 or 8317, which belong to the image services. Only publish host ports for nginx 80 and 443.

### A package disappears after rebuilding the container

That is expected for an ad-hoc Nix profile: `/nix` is part of the container writable layer, while
`/workspace` is the persistent volume. Put the dependency in `flake.nix` and `flake.lock`, then
enter it with `nix develop` after recreating the container.
