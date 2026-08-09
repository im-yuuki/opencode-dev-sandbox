# ============ stage 1: independent frontend build container ============
FROM node:lts-trixie-slim AS frontend-build
WORKDIR /ui
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ .
RUN npm run build

# ============ stage 2: final image ============
FROM debian:trixie
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Etc/UTC
ARG APT_MIRROR=http://mirror.bizflycloud.vn/debian
RUN sed -i "s|http://deb.debian.org/debian$|${APT_MIRROR}|" /etc/apt/sources.list.d/debian.sources

# ============ bootstrap ============
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime

# ============ third-party repositories ============
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | sed -n 's/^NODE_VERSION="\([0-9][0-9]*\)\.x"$/\1/p' > /tmp/node-major
RUN test -s /tmp/node-major
RUN echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$(cat /tmp/node-major).x nodistro main" > /etc/apt/sources.list.d/nodesource.list
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
RUN apt-get update

# ============ node.js ============
RUN apt-get install -y --no-install-recommends nodejs

# ============ python ============
RUN apt-get install -y --no-install-recommends python3 python3-pamela python3-pip python3-venv

# ============ base system ============
RUN apt-get install -y --no-install-recommends supervisor dbus locales tzdata sudo socat git vim htop fastfetch jq unzip zip p7zip-full

# ============ development toolchain ============
RUN apt-get install -y --no-install-recommends build-essential cmake

# ============ web server ============
RUN apt-get install -y --no-install-recommends openssl nginx

# ============ LXQt ============
# lxqt-core pulls session/panel/runner/notificationd/pcmanfm-qt/qterminal but no
# window manager, so openbox is explicit. The full `lxqt` metapackage is skipped
# on purpose: it drags in an image viewer, archiver, mixer and translations.
RUN apt-get install -y --no-install-recommends lxqt-core lxqt-config lxqt-about openbox pcmanfm-qt qterminal featherpad papirus-icon-theme dbus-x11 x11-xserver-utils xauth

# ============ VNC / noVNC ============
RUN apt-get install -y --no-install-recommends tigervnc-standalone-server novnc websockify

# ============ Google Chrome ============
RUN apt-get install -y --no-install-recommends google-chrome-stable

# ============ fonts ============
RUN apt-get install -y --no-install-recommends fonts-liberation fonts-dejavu-core fonts-noto-core

# ============ OpenCode ============
RUN npm install -g opencode-ai

# ============ OpenChamber ============
RUN curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash

# ============ Cloud Commander ============
ARG CLOUDCMD_VERSION=19.20.0
RUN npm install -g "cloudcmd@${CLOUDCMD_VERSION}" --no-audit --no-fund

# ============ code-server ============
ARG CODE_SERVER_VERSION=4.131.0
RUN curl -fsSL -o /tmp/code-server.tar.gz "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-$(dpkg --print-architecture).tar.gz" && tar -xzf /tmp/code-server.tar.gz -C /usr/local/lib && mv "/usr/local/lib/code-server-${CODE_SERVER_VERSION}-linux-$(dpkg --print-architecture)" /usr/local/lib/code-server && rm /tmp/code-server.tar.gz

# ============ user account ============
RUN useradd -m -u 1000 -G sudo -s /bin/bash user
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
COPY etc/novnc/mandatory.json /usr/share/novnc/mandatory.json
# Existing remote origins may have cached Debian's stock empty mandatory.json.
# Give the deployment policy a new URL once, then nginx marks it no-store.
RUN sed -i "s|fetch('./mandatory.json')|fetch('./mandatory.json?v=devbox-resize-v2')|" /usr/share/novnc/vnc.html /usr/share/novnc/vnc_auto.html && grep -q "mandatory.json?v=devbox-resize-v2" /usr/share/novnc/vnc.html && grep -q "mandatory.json?v=devbox-resize-v2" /usr/share/novnc/vnc_auto.html
COPY xstartup /usr/share/devbox/xstartup
COPY scripts/entrypoint.sh /usr/local/sbin/entrypoint.sh
COPY scripts/vnc-run.sh /usr/local/sbin/vnc-run.sh
COPY scripts/root-shell-server /usr/local/sbin/root-shell-server
COPY scripts/google-chrome-stable /usr/local/bin/google-chrome-stable
COPY scripts/code-server /usr/local/bin/code-server
COPY scripts/devbox-root /usr/local/bin/devbox-root
COPY scripts/sudo /usr/local/bin/sudo
RUN chmod +x /usr/local/sbin/entrypoint.sh /usr/local/sbin/vnc-run.sh /usr/local/sbin/root-shell-server /usr/local/bin/google-chrome-stable /usr/local/bin/code-server /usr/local/bin/devbox-root /usr/local/bin/sudo
RUN sed -i 's|Exec=/usr/bin/google-chrome-stable|Exec=/usr/local/bin/google-chrome-stable|g' /usr/share/applications/google-chrome.desktop
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

# ============ container ============
EXPOSE 80 443
VOLUME ["/workspace"]
STOPSIGNAL SIGTERM
WORKDIR /workspace
CMD ["/usr/local/sbin/entrypoint.sh"]
