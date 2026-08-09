# Usage notes

Detailed operating notes for the DevBox. The [README](../README.md) covers the quick start; this
page goes deeper on sudo, Nix, the CLI proxy, the OpenCode config, TLS and Chrome's sandbox.

- [Sudo](#sudo)
- [Nix](#nix)
- [CLI Proxy](#cli-proxy)
- [OpenCode configuration](#opencode-configuration)
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

## CLI Proxy

CLIProxyAPI brokers provider accounts behind one OpenAI-compatible endpoint, with the upstream
Management Center panel baked into the image so it is available offline.

1. Launch **CLI Proxy** from the dashboard.
2. Open **CLI Proxy** from the dashboard — the new tab goes through a small
   bootstrap page that seeds your already-started DevBox session into the panel,
   so there is no second login and no prompt for the management key.
3. Add providers and create proxy API keys there. None are seeded for you.
4. Point in-container agents and CLIs at the proxy:

   ```text
   http://127.0.0.1:8317
   ```

If you need the management key for anything outside the browser, the entrypoint
generates it on first start:

```bash
docker exec -u user devbox sh -c 'cat /workspace/.devbox/cliproxy/management.key'
```

Only the panel and its management API are reachable through the gateway. The `/v1/` proxy surface
is not published, so it stays loopback-only inside the container.

Provider sign-in supports **device-code flows and manual callback-URL submission**, plus plain API
keys. No OAuth callback ports are published, so a browser on another machine cannot be redirected
to a listener inside the container. Use device code or paste the callback URL into the panel.

State lives in `/workspace/.devbox/cliproxy` (mode `0700`): config, management key, provider OAuth
tokens, logs and plugins.

## OpenCode configuration

OpenCode starts with a working global config, seeded on first boot to
`~/.config/opencode/opencode.jsonc` (that is `/workspace/.config/opencode/opencode.jsonc`, on the
persistent volume). It enables LSP, web/code search, the `context7` and `chrome-devtools` MCP
servers, the background-agents and pty plugins, and registers **Local CLIProxyAPI** as a provider
pointing at `http://127.0.0.1:8317/v1`.

Edit it like any other config — the entrypoint writes the file only when neither `opencode.jsonc`
nor `opencode.json` exists there, so your changes are never overwritten by a restart or an image
upgrade. To start over, delete the file and restart the container. The seed template ships at
`/etc/devbox/opencode.jsonc`.

> [!NOTE]
> The provider is configured but has no credentials. Add an account in the CLI Proxy Management
> Center and mint a proxy API key first, otherwise model calls fail with an auth error.

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
| `TLS_SAN` | — | Extra SANs for the generated certificate |

## Chrome sandbox

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
| CLI Proxy (CLIProxyAPI) | `127.0.0.1:8317` | `/management.html` only |

Internal services sit at 9100–9104, so dev servers you run inside the box (3000, 5173, 8080, …)
never collide. CLIProxyAPI is the exception at 8317, outside that range: it keeps the upstream
default port so provider documentation and agent configs work unchanged.