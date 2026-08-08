# ============ stage 1: independent frontend build container ============
FROM node:lts-trixie-slim AS frontend-build
WORKDIR /ui
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ .
RUN npm run build

# ============ stage 2: final image ============
FROM debian:trixie
ENV DEBIAN_FRONTEND=noninteractive container=docker LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Etc/UTC
ARG APT_MIRROR=http://mirror.bizflycloud.vn/debian
RUN sed -i "s|http://deb.debian.org/debian$|${APT_MIRROR}|" /etc/apt/sources.list.d/debian.sources

# ============ bootstrap ============
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg && rm -rf /var/lib/apt/lists/*
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime

# ============ third-party repositories ============
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian trixie stable" > /etc/apt/sources.list.d/docker.list
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | sed -n 's/^NODE_VERSION="\([0-9][0-9]*\)\.x"$/\1/p' > /tmp/node-major
RUN test -s /tmp/node-major
RUN echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$(cat /tmp/node-major).x nodistro main" > /etc/apt/sources.list.d/nodesource.list
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# ============ node.js ============
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

# ============ python ============
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pamela python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# ============ base system ============
RUN apt-get update && apt-get install -y --no-install-recommends supervisor dbus locales tzdata sudo git vim htop fastfetch jq unzip zip p7zip-full && rm -rf /var/lib/apt/lists/*

# ============ development toolchain ============
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake && rm -rf /var/lib/apt/lists/*

# ============ web server ============
RUN apt-get update && apt-get install -y --no-install-recommends openssl nginx && rm -rf /var/lib/apt/lists/*

# ============ KDE Plasma ============
RUN apt-get update && apt-get install -y --no-install-recommends plasma-desktop kwin-x11 dolphin konsole systemsettings kate dbus-x11 x11-xserver-utils xauth && rm -rf /var/lib/apt/lists/*

# ============ VNC / noVNC ============
RUN apt-get update && apt-get install -y --no-install-recommends tigervnc-standalone-server novnc websockify && rm -rf /var/lib/apt/lists/*

# ============ Google Chrome ============
RUN apt-get update && apt-get install -y --no-install-recommends google-chrome-stable && rm -rf /var/lib/apt/lists/*

# ============ fonts ============
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation fonts-dejavu-core fonts-noto-core && rm -rf /var/lib/apt/lists/*

# ============ Docker CE / DinD ============
RUN apt-get update && apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin && rm -rf /var/lib/apt/lists/*

# ============ OpenCode ============
RUN npm install -g opencode-ai

# ============ OpenChamber ============
RUN curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash

# ============ Cloud Commander ============
ARG CLOUDCMD_VERSION=19.20.0
RUN npm install -g "cloudcmd@${CLOUDCMD_VERSION}" --no-audit --no-fund

# ============ code-server ============
ARG CODE_SERVER_VERSION=4.131.0
RUN curl -fsSL -o /tmp/code-server.tar.gz "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-$(dpkg --print-architecture).tar.gz" && tar -xzf /tmp/code-server.tar.gz -C /usr/local/lib && mv "/usr/local/lib/code-server-${CODE_SERVER_VERSION}-linux-$(dpkg --print-architecture)" /usr/local/lib/code-server && ln -s /usr/local/lib/code-server/bin/code-server /usr/local/bin/code-server && rm /tmp/code-server.tar.gz

# ============ user account ============
RUN useradd -m -u 1000 -G docker,sudo -s /bin/bash user
RUN usermod -d /workspace user
RUN printf 'user ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/99-nopasswd
RUN chmod 0440 /etc/sudoers.d/99-nopasswd
RUN mkdir -p /workspace
RUN chown user:user /workspace

# ============ application + configs ============
COPY --from=frontend-build /ui/dist /var/www/launcher
COPY backend/ /opt/devbox/backend/
COPY etc/ /etc/
COPY etc/novnc/defaults.json /usr/share/novnc/defaults.json
COPY xstartup /usr/share/devbox/xstartup
COPY scripts/entrypoint.sh /usr/local/sbin/entrypoint.sh
COPY scripts/vnc-run.sh /usr/local/sbin/vnc-run.sh
RUN chmod +x /usr/local/sbin/entrypoint.sh /usr/local/sbin/vnc-run.sh
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

# ============ Docker runtime ============
RUN mkdir -p /etc/docker
RUN printf '{"storage-driver":"vfs"}\n' > /etc/docker/daemon.json

# ============ container ============
STOPSIGNAL SIGTERM
EXPOSE 9080
VOLUME ["/workspace"]
STOPSIGNAL SIGRTMIN+3
WORKDIR /workspace
CMD ["/usr/local/sbin/entrypoint.sh"]
