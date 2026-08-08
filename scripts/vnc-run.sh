#!/bin/bash
# Foreground TigerVNC + KDE Plasma for supervisord (replaces vnc.service).
# Screen geometry lives here.
set -e

export HOME=/workspace

# Fresh volume or a crashed session can leave stale X locks behind.
# Display :5, away from common dev ports.
mkdir -p /tmp/.X11-unix
rm -f /tmp/.X5-lock /tmp/.X11-unix/X5 2>/dev/null || true

exec /usr/bin/vncserver -fg :5 \
  -geometry 1600x1000 -depth 24 \
  -SecurityTypes None -localhost yes \
  -xstartup /workspace/.config/tigervnc/xstartup
