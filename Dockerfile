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
# KDE Plasma (slim), VNC/noVNC, Google Chrome, Docker CE (DinD).
# supervisor is PID1 (no systemd); dbus provides the system message bus.
RUN apt-get install -y --no-install-recommends \
    nodejs python3 python3-pamela python3-pip python3-venv supervisor dbus locales tzdata sudo git vim htop jq unzip zip p7zip-full build-essential cmake \
    openssl nginx plasma-desktop kwin-x11 dolphin konsole systemsettings kate dbus-x11 x11-xserver-utils xauth \
    tigervnc-standalone-server novnc websockify google-chrome-stable fonts-liberation \
    docker-ce docker-ce-cli containerd.io docker-compose-plugin

RUN rm -rf /var/lib/apt/lists/*

# ---- opencode + openchamber ----
RUN npm install -g opencode-ai

RUN curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash

RUN opencode --version

# ---- code-server (VS Code web) ----
# Prebuilt static tarball, not the npm package: npm's argon2 dependency
# compiles from source and breaks under node 24 on arm64. Release assets are
# named after the arch (linux-amd64, linux-arm64), so no mapping is needed;
# an unsupported arch simply 404s and fails the build.
ARG CODE_SERVER_VERSION=4.131.0
RUN curl -fsSL -o /tmp/code-server.tar.gz \
    "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-$(dpkg --print-architecture).tar.gz" \
  && tar -xzf /tmp/code-server.tar.gz -C /usr/local/lib \
  && mv "/usr/local/lib/code-server-${CODE_SERVER_VERSION}-linux-$(dpkg --print-architecture)" /usr/local/lib/code-server \
  && ln -s /usr/local/lib/code-server/bin/code-server /usr/local/bin/code-server \
  && rm /tmp/code-server.tar.gz

RUN code-server --version

RUN openchamber --version

# ---- user account (home = /workspace, password set on first web visit) ----
# The name is fixed: the control plane, supervisor programs and nginx all
# assume uid 1000 / "user", so making it configurable only invited drift.
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
COPY scripts/vnc-run.sh /usr/local/sbin/vnc-run.sh

RUN chmod +x /usr/local/sbin/entrypoint.sh /usr/local/sbin/vnc-run.sh

RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

# Docker's overlayfs cannot nest on Docker Desktop's overlay filesystem.
# vfs is slower/larger, but works reliably for true DinD on macOS and Linux hosts.
RUN mkdir -p /etc/docker

RUN printf '{"storage-driver":"vfs"}\n' > /etc/docker/daemon.json

# dockerd keeps its stock listener — unix socket only, no 0.0.0.0:2375.
# The exit signal is plain SIGTERM: supervisord (PID1) forwards it to the
# supervised programs and waits for them to stop gracefully.
STOPSIGNAL SIGTERM
EXPOSE 8080

VOLUME ["/workspace"]

STOPSIGNAL SIGRTMIN+3
WORKDIR /workspace
CMD ["/usr/local/sbin/entrypoint.sh"]