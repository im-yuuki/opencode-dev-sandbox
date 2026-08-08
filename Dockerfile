# ============ stage 1: independent frontend build container ============
FROM node:lts-bookworm-slim AS frontend-build
WORKDIR /ui
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ .
RUN npm run build

# ============ stage 2: final image ============
FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive container=docker LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Etc/UTC

# Faster apt mirror for the main archive. Override with
#   --build-arg APT_MIRROR=http://deb.debian.org/debian
# http (not https): base image has no CA bundle yet at this point.
# trixie-security is not carried by the mirror, so it stays on deb.debian.org.
ARG APT_MIRROR=http://mirror.bizflycloud.vn/debian
RUN sed -i "s|http://deb.debian.org/debian$|${APT_MIRROR}|" /etc/apt/sources.list.d/debian.sources

# Small bootstrap so third-party repos can be added (docker, NodeSource, Chrome).
# apt-get update runs exactly twice in this whole build: here and below.
RUN apt-get update

RUN apt-get install -y --no-install-recommends curl ca-certificates gnupg

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime

# ---- third-party repos: docker-ce, NodeSource, Google Chrome ----
# Node LTS major is resolved at build time from setup_lts.x (latest LTS), not
# pinned; the builder stage uses node:lts for the same reason.
# openchamber needs >= 22.
# Chrome's stable suite publishes amd64 and arm64, so it survives the multi-arch
# CI build. `arch=` is pinned per stage arch anyway.
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg

RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian trixie stable" > /etc/apt/sources.list.d/docker.list

RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg

RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | sed -n 's/^NODE_VERSION="\([0-9][0-9]*\)\.x"$/\1/p' > /tmp/node-major

# Guard: an empty file here would silently produce a bogus repo line below.
RUN test -s /tmp/node-major

RUN echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$(cat /tmp/node-major).x nodistro main" > /etc/apt/sources.list.d/nodesource.list

RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg

RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# Second (and last) apt-get update: all repos are in place now.
RUN apt-get update

# node runtime (bundles npm), python control plane, base system + dev toolchain,
# KDE Plasma (slim), VNC/noVNC, Google Chrome, Cockpit, Docker CE (DinD).
RUN apt-get install -y --no-install-recommends \
    nodejs python3 python3-pamela python3-pip python3-venv systemd systemd-sysv locales tzdata sudo git vim htop jq unzip zip p7zip-full build-essential cmake \
    openssl nginx plasma-desktop kwin-x11 dolphin konsole systemsettings kate dbus-x11 x11-xserver-utils xauth \
    tigervnc-standalone-server novnc websockify google-chrome-stable fonts-liberation cockpit cockpit-system cockpit-ws \
    docker-ce docker-ce-cli containerd.io docker-compose-plugin

RUN rm -rf /var/lib/apt/lists/*

# ---- ttyd (web terminal) - not packaged in trixie, use static binary ----
# Release assets are named after `uname -m` (ttyd.x86_64, ttyd.aarch64), so no
# arch mapping is needed; an unsupported arch simply 404s and fails the build.
RUN curl -fsSL -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$(uname -m)

RUN chmod +x /usr/local/bin/ttyd

RUN ttyd --version

# ---- opencode + openchamber ----
RUN npm install -g opencode-ai

RUN curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash

RUN opencode --version

RUN openchamber --version

# ---- user account (home = /workspace, password set on first web visit) ----
# The name is fixed: the control plane, systemd units and nginx all assume
# uid 1000 / "user", so making it configurable only invited drift.
RUN useradd -m -u 1000 -G docker,sudo -s /bin/bash user

RUN usermod -d /workspace user

RUN printf 'user ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/99-nopasswd

RUN chmod 0440 /etc/sudoers.d/99-nopasswd

RUN mkdir -p /workspace

RUN chown user:user /workspace

# ---- app + configs ----
COPY --from=frontend-build /ui/dist /var/www/ui
COPY backend/ /opt/devbox/backend/
COPY etc/ /etc/
COPY xstartup /usr/share/devbox/xstartup
COPY scripts/entrypoint.sh /usr/local/sbin/entrypoint.sh

RUN chmod +x /usr/local/sbin/entrypoint.sh

RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

# Docker's overlayfs cannot nest on Docker Desktop's overlay filesystem.
# vfs is slower/larger, but works reliably for true DinD on macOS and Linux hosts.
RUN mkdir -p /etc/docker

RUN printf '{"storage-driver":"vfs"}\n' > /etc/docker/daemon.json

# dockerd keeps its stock listener — unix socket only, no 0.0.0.0:2375.

# ---- systemd enable + mask ----
# `|| true` is deliberate: these fail harmlessly under builders that cannot run
# systemctl, and the build must not die on them.
RUN systemctl set-default graphical.target || true

RUN systemctl enable docker.service cockpit.socket nginx.service openchamber.service vnc.service websockify.service ttyd.service devbox-api.service || true

RUN systemctl mask systemd-networkd systemd-resolved systemd-hostnamed getty@tty1.service console-getty.service || true

EXPOSE 8080

VOLUME ["/workspace"]

STOPSIGNAL SIGRTMIN+3
WORKDIR /workspace
CMD ["/usr/local/sbin/entrypoint.sh"]