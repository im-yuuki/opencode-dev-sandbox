# ============ stage 1: independent frontend build container ============
FROM node:lts-bookworm-slim AS frontend-build
WORKDIR /ui
COPY www/package.json www/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY www/ .
RUN npm run build

# ============ stage 2: final image ============
FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive \
    container=docker \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=Etc/UTC

# Faster apt mirror for the main archive. Override with
#   --build-arg APT_MIRROR=http://deb.debian.org/debian
# http (not https): base image has no CA bundle yet at this point.
# trixie-security is not carried by the mirror, so it stays on deb.debian.org.
ARG APT_MIRROR=http://mirror.bizflycloud.vn/debian
RUN sed -i "s|http://deb.debian.org/debian$|${APT_MIRROR}|" /etc/apt/sources.list.d/debian.sources

# Small bootstrap so third-party repos can be added (docker, NodeSource 22).
# apt-get update runs exactly twice in this whole build: here and below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime

# Add docker-ce + NodeSource + Google Chrome repos, then ONE apt refresh covers
# everything.
# Node LTS major is resolved at build time from setup_lts.x (latest LTS), not
# pinned; the builder stage uses node:lts for the same reason.
# openchamber needs >= 22.
# Chrome's stable suite publishes amd64 and arm64, so it survives the multi-arch
# CI build. `arch=` is pinned per stage arch anyway.
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian trixie stable" > /etc/apt/sources.list.d/docker.list \
    && NODE_MAJOR="$(curl -fsSL https://deb.nodesource.com/setup_lts.x | sed -n 's/^NODE_VERSION="\([0-9][0-9]*\)\.x"$/\1/p')" \
    && test -n "$NODE_MAJOR" \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        # node runtime (bundles npm) + python control plane
        nodejs \
        python3 python3-pamela python3-pip python3-venv \
        # base system + dev toolchain
        systemd systemd-sysv \
        locales tzdata sudo git vim htop jq unzip zip p7zip-full \
        build-essential cmake \
        openssl nginx \
        # KDE Plasma (slim): desktop, files, terminal, settings, text editor
        plasma-desktop kwin-x11 dolphin konsole systemsettings kate \
        dbus-x11 x11-xserver-utils xauth \
        # VNC + noVNC + websockify
        tigervnc-standalone-server novnc websockify \
        # Google Chrome (its deps come from the package; fonts do not)
        google-chrome-stable fonts-liberation \
        # Cockpit (web admin)
        cockpit cockpit-system cockpit-ws \
        # Docker CE (DinD)
        docker-ce docker-ce-cli containerd.io docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# ---- ttyd (web terminal) - not packaged in trixie, use static binary ----
RUN ARCH="$(uname -m)"; case "$ARCH" in \
        x86_64)  TBIN=ttyd.x86_64 ;; \
        aarch64|arm64) TBIN=ttyd.aarch64 ;; \
        *) echo "unsupported arch $ARCH"; exit 1 ;; \
      esac \
    && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/${TBIN}" \
    && chmod +x /usr/local/bin/ttyd \
    && ttyd --version

# ---- opencode + openchamber ----
RUN npm install -g opencode-ai \
    && curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash \
    && opencode --version \
    && openchamber --version

ARG WEB_USER=user
ARG WEB_PASSWORD=changeme

# ---- user account (home = /workspace, password set on first web visit) ----
RUN useradd -m -u 1000 -G docker,sudo -s /bin/bash "$WEB_USER" \
    && usermod -d /workspace "$WEB_USER" \
    && echo "$WEB_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/99-nopasswd \
    && chmod 0440 /etc/sudoers.d/99-nopasswd \
    && mkdir -p /workspace \
    && chown "$WEB_USER:$WEB_USER" /workspace

# ---- app + configs ----
COPY --from=frontend-build /ui/dist /var/www/ui
COPY backend/ /opt/devbox/backend/
COPY etc/ /etc/
COPY xstartup /usr/share/devbox/xstartup
COPY scripts/entrypoint.sh /usr/local/sbin/entrypoint.sh

RUN chmod +x /usr/local/sbin/entrypoint.sh \
    && rm -f /etc/nginx/sites-enabled/default \
    && rm -f /etc/nginx/conf.d/default.conf

# Docker's overlayfs cannot nest on Docker Desktop's overlay filesystem.
# vfs is slower/larger, but works reliably for true DinD on macOS and Linux hosts.
RUN mkdir -p /etc/docker \
    && printf '{"storage-driver":"vfs"}\n' > /etc/docker/daemon.json

# dockerd: listen on tcp:2375 too (container-local DinD API)
RUN mkdir -p /etc/systemd/system/docker.service.d \
    && printf '[Service]\nExecStart=\nExecStart=/usr/bin/dockerd -H tcp://0.0.0.0:2375 -H unix:///var/run/docker.sock\n' > /etc/systemd/system/docker.service.d/override.conf

# ---- systemd enable + mask ----
RUN systemctl set-default graphical.target >/dev/null 2>&1 || true \
    && systemctl enable docker.service cockpit.socket nginx.service \
       openchamber.service vnc.service websockify.service ttyd.service \
       devbox-api.service >/dev/null 2>&1 \
    || true \
    && systemctl mask systemd-networkd systemd-resolved systemd-hostnamed \
                  getty@tty1.service console-getty.service >/dev/null 2>&1 || true

EXPOSE 8080 2375

VOLUME ["/workspace"]

STOPSIGNAL SIGRTMIN+3
WORKDIR /workspace
CMD ["/usr/local/sbin/entrypoint.sh"]