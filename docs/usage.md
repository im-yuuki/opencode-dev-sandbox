# Usage notes

Detailed operating notes for the opencode-dev-sanbox. The [README](../README.md) covers the quick start; this
page goes deeper on sudo, Nix, the OpenCode config, TLS and Chrome's sandbox.

- [Sudo](#sudo)
- [Nix](#nix)
- [OpenCode configuration](#opencode-configuration)
- [Hostname](#hostname)
- [Custom hostname or LAN address in the certificate](#custom-hostname-or-lan-address-in-the-certificate)
- [Environment variables](#environment-variables)
- [Chrome sandbox](#chrome-sandbox)
- [Ports](#ports)

## Sudo

The account `user` is a member of the `sudo` group and escalation goes through the real
`/usr/bin/sudo`:

```bash
sudo apt-get update
```

That prompts for the password you set on the first-run web form, and standard Debian sudo policy
and timestamp caching apply.

- The web password *is* the Unix password. There is one credential, not two.
- Only the Unix shadow hash is persisted at `/workspace/.devbox/user-password.hash`, so the same
  login and sudo password survives container recreation as long as the workspace volume is kept.
- Until first-run setup completes the account is locked, so `sudo` cannot be used at all.
- There is no `NOPASSWD` sudoers drop-in and no passwordless escalation.
- `devbox-root` and the fake `sudo` shim from earlier versions are gone.
- The Cloud Run `no_new_privs` workaround is not supported and has no replacement. On a runtime
  that forbids setuid escalation, `sudo` will not work.

## Nix

Nix runs single-user with no `nix-daemon`, and `/nix` is owned by uid 1000. Installing packages
needs no sudo:

```bash
nix profile install nixpkgs#ripgrep
nix shell nixpkgs#gcc nixpkgs#cmake
nix develop
```

`nix-command` and `flakes` are enabled in `/etc/nix/nix.conf`.

> [!WARNING]
> **The Nix store does not persist across container recreation.** `/nix` lives in the container
> writable layer, not on the `/workspace` volume, so:
>
> - `docker restart` and `docker stop`/`start` keep everything you installed.
> - `docker rm` followed by a fresh `docker run` loses it. `/workspace` is unaffected.

State and cache are pinned to `/nix/var/nix/user-state` and `/nix/var/nix/user-cache` rather than
`$HOME`, so a recreated container never leaves a profile symlinked to store paths that no longer
exist.

Because of that, commit `flake.nix` and `flake.lock` with the project and let `nix develop`
rebuild the environment. A per-project flake restores itself; a `nix profile install` does not.

> [!WARNING]
> Single-user Nix does not sandbox derivations (`sandbox = false`). Builds run with the same uid as
> the agent. That is fine for your own projects and not appropriate for untrusted derivations.

## User-local packages

OpenChamber is installed as a uid 1000 npm package under the persistent workspace prefix:

```text
/workspace/.local/bin
/workspace/.local/lib/node_modules
```

OpenCode v2 is a standalone binary installed with the upstream installer
(`curl -fsSL https://opencode.ai/v2/install | bash`) under the persistent
workspace directory:

```text
/workspace/.opencode/bin
```

The managed service environment puts both `bin` directories first on `PATH`.
OpenCode self-updates into `/workspace/.opencode` and OpenChamber updates through
its web UI, so neither requires root or write access to `/usr`.

The image keeps user-owned seeds outside the workspace and copies them only when the
corresponding binary is missing from the volume. Existing user-installed versions are
never overwritten. After updating OpenChamber from its web UI, restart the **Agent**
application from the Launcher to load the new server process; the upstream container
update flow intentionally keeps the current server online.

## OpenCode configuration

OpenCode starts with a working global config, seeded on first boot to
`~/.config/opencode/opencode.jsonc` (that is `/workspace/.config/opencode/opencode.jsonc`, on the
persistent volume). It enables LSP, web/code search, the `context7` and `chrome-devtools` MCP
servers and the background-agents and pty plugins.

## Hostname

The in-sandbox hostname is `devbox` by default. Docker would otherwise assign the
12-hex container ID, which changes on every recreate. Precedence: explicit
`docker run --hostname` wins, else `-e DEVBOX_HOSTNAME`, else a random-looking ID
is replaced with `devbox`. Changing the name at runtime needs `CAP_SYS_ADMIN`,
so without the daemon flag the entrypoint applies it on a best-effort basis and
still normalizes `/etc/hosts` (keeps `sudo` quiet) and `$HOSTNAME`.

## Custom hostname or LAN address in the certificate

Set extra SANs on first boot:

```bash
-e TLS_SAN="DNS:devbox.lan,IP:192.168.1.10"
```

Only read when the certificate does not exist yet. To regenerate, delete
`/workspace/.devbox/tls` and restart the container. You can also drop your own
`devbox.crt` / `devbox.key` in that directory.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `DEVBOX_HOSTNAME` | `devbox` | Stable in-sandbox hostname (explicit `--hostname` wins) |
| `TLS_SAN` | — | Extra SANs for the generated certificate |

## Chrome sandbox

Chrome's renderer sandbox creates an unprivileged user namespace. Docker's default seccomp
profile blocks that operation, so the quick start uses `seccomp=unconfined`. The container still
receives no host devices, host namespaces, host socket, or host-level capabilities.

At boot the image probes `unshare -Ur`. If it is unavailable, Chrome starts with `--no-sandbox`
rather than failing silently. The wrapper passes every other argument through unchanged. This
reduces browser defense in depth; use the quick-start setting when the desktop browser is exposed
to untrusted web content.

If the probe fails despite the seccomp setting, the host may disallow unprivileged user
namespaces:

```bash
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

Recent Ubuntu hosts can additionally restrict unprivileged user namespaces through AppArmor:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

> [!CAUTION]
> These are host-wide settings; evaluate them against your threat model before changing them.

## Ports

The public nginx gateway listens on 80 (plaintext HTTP) and 443 (self-signed TLS). Everything else
binds loopback only:

| Service | Internal endpoint | Public route |
| --- | --- | --- |
| Agent (OpenChamber) | `127.0.0.1:9100` | `/` |
| Code (code-server) | `127.0.0.1:9101` | `/code/` |
| Control API (devbox-api) | `127.0.0.1:9102` | `/launcher/api/` |
| Desktop bridge (websockify) | `127.0.0.1:9103` | `/vnc/` |
| Files (FileBrowser) | `127.0.0.1:9104` | `/files/` |
| Web terminal broker | `127.0.0.1:9105` | `/terminal/api/`, `/terminal/ws/` |

Internal services sit at 9100–9105, so dev servers you run inside the box (3000, 5173, 8080, …)
never collide.

## Web terminal sessions

The Terminal application stores each tab as a private tmux session. A browser WebSocket is only an
attachment to that session: closing the tab, closing the browser or losing the network does not
terminate the shell or commands running inside it. Reopen the Terminal application to enumerate
existing sessions and reconnect automatically.

The **Kill** action is separate from detaching a tab and terminates the tmux session. Sessions and
their processes cannot survive `docker restart` or container recreation because they are runtime
processes, not files on `/workspace`.
