# syntax=docker/dockerfile:1.7

# ============ stage 1: independent frontend build container ============
FROM node:lts-trixie-slim AS frontend-build
WORKDIR /ui
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund
COPY web/ .
RUN npm run build

# ============ stage 2: final image ============
FROM debian:trixie-slim
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Etc/UTC
ARG APT_MIRROR=http://mirror.bizflycloud.vn/debian
RUN sed -i "s|http://deb.debian.org/debian$|${APT_MIRROR}|" /etc/apt/sources.list.d/debian.sources
RUN ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime

# ============ bootstrap ============
# APT indexes and downloaded archives live in BuildKit caches, not image layers.
# Each transaction updates its own index so stale lists never become part of the
# final image. The cache mounts are shared across rebuilds and architectures.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends aria2 curl wget ca-certificates gnupg

# aria2 is reserved for large package archives. Eight connections are enough
# to improve a slow single stream without creating excessive server load.
ENV ARIA2_OPTS="--console-log-level=error --summary-interval=0 --download-result=hide --file-allocation=none -x 8 -s 8"

# ============ third-party repository keys ============
# gnupg is not a build-only dependency here: it stays in the final image as one
# of the shipped CLI tools, so dearmoring the keys in place costs nothing.
# cloudflare-main.gpg is already dearmored upstream, so it is fetched as-is.
RUN set -eux; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg; \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg; \
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg

# ============ repository lists ============
# Node's major version is pinned to the current LTS at build time, resolved once
# from setup_lts.x rather than maintaining a static major here.
RUN set -eux; \
    node_major="$(curl -fsSL https://deb.nodesource.com/setup_lts.x | sed -n 's/^NODE_VERSION="\([0-9][0-9]*\)\.x"$/\1/p')"; \
    test -n "$node_major"; \
    echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${node_major}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list; \
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list

# ============ packages ============
# One layer per category keeps unrelated package changes cacheable. BuildKit
# cache mounts make the repeated update/install transactions cheap without
# retaining APT indexes in the image.
#
# No C/C++ toolchain and no CMake anywhere: those are installed per-project
# through Nix (`nix shell nixpkgs#gcc nixpkgs#cmake`).

# ---- language runtimes ----
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends nodejs python3 python3-aiohttp python3-pamela python3-pip python3-venv

# ---- service infrastructure ----
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends supervisor nginx openssl dbus dbus-x11 locales tzdata sudo git nix-bin

# ---- shell and filesystem tools ----
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends coreutils bash-completion less file tree findutils grep sed gawk diffutils procps psmisc util-linux lsof tmux tar gzip bzip2 xz-utils zstd zip unzip 7zip rsync jq sqlite3 vim nano ripgrep fd-find fzf bat eza htop btop fastfetch strace ltrace time binutils xxd binwalk

# ---- network tools ----
# tcpdump, nmap and ping still depend on Linux capabilities the container
# runtime grants; the image never asks for privileged mode on their behalf.
# cloudflared comes from the Cloudflare apt repo added in the bootstrap step.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends openssh-client iproute2 iputils-ping bind9-dnsutils netcat-openbsd socat traceroute mtr-tiny whois iperf3 nmap tcpdump cloudflared

# ---- LXQt desktop ----
# lxqt-core pulls session/panel/runner/notificationd/pcmanfm-qt/qterminal but no
# window manager, so openbox is explicit. The full `lxqt` metapackage is skipped
# on purpose -- it drags in an image viewer, archiver, mixer and translations.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends lxqt-core lxqt-config lxqt-about openbox pcmanfm-qt qterminal featherpad papirus-icon-theme x11-xserver-utils xauth

# ---- VNC / noVNC ----
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends tigervnc-standalone-server novnc websockify

# ---- Chrome and fonts ----
# Kept last and together: Chrome is the single largest package here and its
# rendering depends on these fonts, so they share a layer and a cache lifetime.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; apt-get update; apt-get install -y --no-install-recommends google-chrome-stable fonts-liberation fonts-dejavu-core fonts-noto-core

# ============ Node global packages ============
# OpenChamber ships @openchamber/web on npm, so it is installed from the
# registry rather than by piping install.sh from the main branch through bash.
# OpenCode's out-of-the-box config is seeded per-workspace by the entrypoint
# from /etc/devbox/opencode.jsonc, not baked into a global path here.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    set -eux; npm install -g --no-audit --no-fund opencode-ai @openchamber/web; rm -rf /tmp/*

# ============ code-server ============
RUN set -eux; arch="$(dpkg --print-architecture)"; ver="$(curl -fsSL https://api.github.com/repos/coder/code-server/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')"; test -n "$ver"; aria2c $ARIA2_OPTS -o /tmp/cs.tar.gz "https://github.com/coder/code-server/releases/download/v${ver}/code-server-${ver}-linux-${arch}.tar.gz"; mkdir -p /usr/local/lib/code-server; tar -xzf /tmp/cs.tar.gz -C /usr/local/lib/code-server --strip-components=1; rm -rf /tmp/cs.tar.gz

# ============ FileBrowser Quantum ============
# gtsteffaniak/filebrowser, Apache-2.0.
RUN set -eux; arch="$(dpkg --print-architecture)"; curl -fsSL -o /usr/local/bin/filebrowser "https://github.com/gtsteffaniak/filebrowser/releases/latest/download/linux-${arch}-filebrowser"; chmod 0755 /usr/local/bin/filebrowser

# ============ CLIProxyAPI + Management Center ============
# MIT. The default (glibc/plugin) build is fine: trixie is well past the
# GLIBC 2.17 baseline. Upstream names the 64-bit ARM archive aarch64, not arm64.
# The panel asset is baked in so the proxy never has to fetch it at runtime.
RUN set -eux; case "$(dpkg --print-architecture)" in amd64) arch=amd64 ;; arm64) arch=aarch64 ;; *) echo "unsupported architecture" >&2; exit 1 ;; esac; ver="$(curl -fsSL https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')"; test -n "$ver"; aria2c $ARIA2_OPTS -o /tmp/cliproxy.tar.gz "https://github.com/router-for-me/CLIProxyAPI/releases/download/v${ver}/CLIProxyAPI_${ver}_linux_${arch}.tar.gz"; mkdir -p /tmp/cliproxy; tar -xzf /tmp/cliproxy.tar.gz -C /tmp/cliproxy cli-proxy-api; install -D -m 0755 /tmp/cliproxy/cli-proxy-api /usr/local/bin/cliproxyapi; install -d -m 0755 /opt/cliproxy/static; curl -fsSL -o /opt/cliproxy/static/management.html "https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases/latest/download/management.html"; chmod 0644 /opt/cliproxy/static/management.html; rm -rf /tmp/cliproxy /tmp/cliproxy.tar.gz

# ============ user account ============
# Member of the sudo group with no sudoers drop-in: escalation goes through the
# real /usr/bin/sudo and the Unix password set during first-run web setup.
RUN set -eux; useradd -m -u 1000 -G sudo -s /bin/bash user; usermod -d /workspace user; mkdir -p /workspace; chown user:user /workspace

# ============ Nix (single-user) ============
# Store owned by uid 1000 so the agent installs packages without sudo. No
# nix-daemon and no nixbld group; state/cache live under /nix rather than in
# $HOME, which is the persistent volume, so a recreated container cannot leave
# profile symlinks pointing at store paths that no longer exist.
#
# nix-bin ships its own /etc/nix/nix.conf, so ours is copied explicitly here,
# after the package is installed, rather than relying on the blanket
# `COPY etc/ /etc/` further down to win the race.
COPY etc/nix/nix.conf /etc/nix/nix.conf
RUN set -eux; mkdir -p /nix /nix/var/nix/user-state /nix/var/nix/user-cache; chown -R user:user /nix; grep -q '^build-users-group =$' /etc/nix/nix.conf

# ============ application + configs ============
COPY --from=frontend-build /ui/dist /var/www/launcher
COPY backend/ /opt/devbox/backend/
COPY etc/ /etc/
COPY etc/novnc/defaults.json /usr/share/novnc/defaults.json
COPY etc/novnc/mandatory.json /usr/share/novnc/mandatory.json
# Existing remote origins may have cached Debian's stock empty mandatory.json.
# Give the deployment policy a new URL once, then nginx marks it no-store.
RUN sed -i "s|fetch('./mandatory.json')|fetch('./mandatory.json?v=devbox-resize-v2')|" /usr/share/novnc/vnc.html /usr/share/novnc/vnc_auto.html && grep -q "mandatory.json?v=devbox-resize-v2" /usr/share/novnc/vnc.html && grep -q "mandatory.json?v=devbox-resize-v2" /usr/share/novnc/vnc_auto.html
COPY etc/devbox/xstartup /usr/share/devbox/xstartup
COPY etc/devbox/mc-boot.html /var/www/launcher/mc-boot.html
COPY scripts/entrypoint.sh /usr/local/sbin/entrypoint.sh
COPY scripts/vnc-run.sh /usr/local/sbin/vnc-run.sh
COPY scripts/google-chrome-stable /usr/local/bin/google-chrome-stable
COPY scripts/code-server /usr/local/bin/code-server
COPY scripts/devbox-user-env /usr/local/bin/devbox-user-env
RUN set -eux; chmod +x /usr/local/sbin/entrypoint.sh /usr/local/sbin/vnc-run.sh /usr/local/bin/google-chrome-stable /usr/local/bin/code-server /usr/local/bin/devbox-user-env; sed -i 's|Exec=/usr/bin/google-chrome-stable|Exec=/usr/local/bin/google-chrome-stable|g' /usr/share/applications/google-chrome.desktop; rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

# ============ container ============
EXPOSE 80 443
VOLUME ["/workspace"]
STOPSIGNAL SIGTERM
WORKDIR /workspace
CMD ["/usr/local/sbin/entrypoint.sh"]
