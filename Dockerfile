# DevBox: Debian Trixie + systemd + KDE Plasma + noVNC + Cockpit + opencode + openchamber + DinD
FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive \
    container=docker \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=Etc/UTC

# Small bootstrap first so we can fetch third-party repos (docker) later.
# apt-get update is called exactly twice in this whole build: here and for the
# combined layer below. Keeps network/index-refresh time low.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime

# Single apt refresh covering base toolchain + deps + desktop + docker CE.
# Node is NOT via apt (tarball below) so we don't need the NodeSource repo.
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian trixie stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        # base system + dev toolchain
        systemd systemd-sysv \
        locales tzdata sudo git vim htop jq unzip zip p7zip-full \
        build-essential cmake \
        python3 python3-pip python3-venv \
        openssl apache2-utils nginx \
        # KDE Plasma (slim) + VNC + noVNC + websockify
        plasma-desktop kwin-x11 dolphin konsole \
        dbus-x11 x11-xserver-utils xauth \
        tigervnc-standalone-server novnc websockify \
        # Cockpit (web admin)
        cockpit cockpit-system cockpit-ws \
        # Docker CE (DinD)
        docker-ce docker-ce-cli containerd.io docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# ---- Node.js 22 (official tarball; openchamber needs >= 22) ----
RUN ARCH="$(dpkg --print-architecture)"; case "$ARCH" in \
        amd64)  NARCH=linux-x64 ;; \
        arm64)  NARCH=linux-arm64 ;; \
        *) echo "unsupported arch $ARCH"; exit 1 ;; \
      esac \
    && curl -fsSLo /tmp/node.txz "https://nodejs.org/dist/v22.23.2/node-v22.23.2-$NARCH.tar.xz" \
    && tar -xJf /tmp/node.txz -C /usr/local --strip-components=1 \
    && rm /tmp/node.txz \
    && node -v && npm -v

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
# openchamber needs Node >= 22 (has it) and opencode CLI in PATH
RUN npm install -g opencode-ai \
    && curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash \
    && opencode --version \
    && openchamber --version

ARG WEB_USER=user
ARG WEB_PASSWORD=changeme

# ---- user account (home = /workspace) ----
RUN useradd -m -u 1000 -G docker,sudo -s /bin/bash "$WEB_USER" \
    && usermod -d /workspace "$WEB_USER" \
    && echo "$WEB_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/99-nopasswd \
    && chmod 0440 /etc/sudoers.d/99-nopasswd \
    && mkdir -p /workspace \
    && chown "$WEB_USER:$WEB_USER" /workspace

# ---- configs ----
COPY etc/ /etc/
COPY index.html /opt/www/index.html
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
       openchamber.service vnc.service websockify.service ttyd.service >/dev/null 2>&1 \
    || true \
    && systemctl mask systemd-networkd systemd-resolved systemd-hostnamed \
                  getty@tty1.service console-getty.service >/dev/null 2>&1 || true

EXPOSE 8080 2375

VOLUME ["/workspace"]

STOPSIGNAL SIGRTMIN+3
WORKDIR /workspace
CMD ["/usr/local/sbin/entrypoint.sh"]