#!/bin/bash
# Foreground TigerVNC + KDE Plasma for supervisord (replaces vnc.service).
# Screen geometry lives here.
set -e

export HOME=/workspace

# Fresh volume or a crashed session can leave stale X locks behind.
# Display :5, away from common dev ports.
mkdir -p /tmp/.X11-unix
rm -f /tmp/.X5-lock /tmp/.X11-unix/X5 2>/dev/null || true

# Some runtimes expose /dev/dri, so TigerVNC's default rendernode=auto enables
# DRI3. Its accelerated framebuffer can retain the old row stride after
# a RandR shrink, producing horizontal corruption. Software rendering is stable
# and matches Docker Desktop hosts, which have no DRM render node.
exec /usr/bin/vncserver -fg :5 \
  -geometry 1600x1000 -depth 24 \
  -rendernode "" \
  -AcceptSetDesktopSize \
  -SecurityTypes None -localhost yes \
  -xstartup /workspace/.config/tigervnc/xstartup
