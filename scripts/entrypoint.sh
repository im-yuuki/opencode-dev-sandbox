#!/bin/bash
# PID1 entrypoint: seed workspace, secrets, then exec supervisord.
set -e

# Fixed, matching the Dockerfile: the control plane (DEVBOX_USER), the
# supervisor programs and /run/user/1000 all assume this account.
WEB_USER=user

# ---- ensure user + home ----
id "$WEB_USER" >/dev/null 2>&1 || {
  useradd -m -u 1000 -G sudo -s /bin/bash "$WEB_USER"
  echo "$WEB_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/99-nopasswd
  chmod 0440 /etc/sudoers.d/99-nopasswd
}
usermod -d /workspace "$WEB_USER" 2>/dev/null || true
mkdir -p /workspace
chown "$WEB_USER:$WEB_USER" /workspace

# Cloud Commander keeps its user-adjustable preferences (notably ZIP vs
# tar.gz packing) outside the browsable workspace root.
mkdir -p /workspace/.devbox/cloudcmd
chown "$WEB_USER:$WEB_USER" /workspace/.devbox/cloudcmd
chmod 700 /workspace/.devbox/cloudcmd

# NOTE: no password is set here. The account is created locked and the user
# sets their own password on first visit via the web UI (Linux PAM + chpasswd).

# ---- seed /workspace skeleton (survives empty volume mount) ----
# TigerVNC (Debian trixie) uses $HOME/.config/tigervnc; legacy ~/.vnc only
# triggers a migration that fails on fresh volumes, so seed XDG dir directly.
su -s /bin/bash "$WEB_USER" -c '
  rm -rf "$HOME/.vnc" 2>/dev/null || true
  mkdir -p "$HOME/.config/tigervnc" "$HOME/.config/lxqt" "$HOME/.local/share"

  # The desktop moved from KDE Plasma to LXQt. A workspace volume created by an
  # older image still holds an xstartup that execs startplasma-x11, which is no
  # longer installed, so the session would fail to start every time. Move any
  # such file aside (kept as .kde.bak, never deleted) and reseed.
  if [ -f "$HOME/.config/tigervnc/xstartup" ] \
     && grep -q "startplasma-x11" "$HOME/.config/tigervnc/xstartup"; then
    mv "$HOME/.config/tigervnc/xstartup" "$HOME/.config/tigervnc/xstartup.kde.bak"
  fi
  if [ ! -f "$HOME/.config/tigervnc/xstartup" ]; then
    cp /usr/share/devbox/xstartup "$HOME/.config/tigervnc/xstartup"
  fi
  chmod +x "$HOME/.config/tigervnc/xstartup"

  if [ ! -f "$HOME/.bashrc" ]; then
    printf "cd /workspace\nPS1=\"\\\\u@\\\\h:\\\\w$ \"\n" > "$HOME/.bashrc"
  fi
  # lxqt-core ships no window manager; name openbox explicitly or the session
  # comes up with bare, undecorated windows.
  if [ ! -f "$HOME/.config/lxqt/session.conf" ]; then
    printf "[General]\nwindow_manager=openbox\n" \
      > "$HOME/.config/lxqt/session.conf"
  fi
  if [ ! -f "$HOME/.config/lxqt/lxqt.conf" ]; then
    printf "[General]\nicon_theme=Papirus\n" \
      > "$HOME/.config/lxqt/lxqt.conf"
  fi
'

# ---- TLS: self-signed cert, generated once on first run ----
# Lives on the /workspace volume so the browser's trust exception survives a
# container rebuild; delete the directory to force a new pair. The key is
# root-owned 0600 — `user` has passwordless sudo anyway, but nothing that runs
# as the account needs to read it (nginx opens it as root before dropping).
TLS_DIR=/workspace/.devbox/tls
TLS_CRT="$TLS_DIR/devbox.crt"
TLS_KEY="$TLS_DIR/devbox.key"

if [ ! -s "$TLS_CRT" ] || [ ! -s "$TLS_KEY" ]; then
  mkdir -p "$TLS_DIR"
  # SANs: the names a browser can actually reach the box by. TLS_SAN adds extra
  # comma-separated entries (e.g. TLS_SAN="DNS:devbox.lan,IP:192.168.1.10").
  san="DNS:localhost,DNS:$(hostname),IP:127.0.0.1,IP:0:0:0:0:0:0:0:1"
  [ -n "${TLS_SAN:-}" ] && san="$san,$TLS_SAN"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$TLS_KEY" -out "$TLS_CRT" \
    -subj "/CN=devbox" -addext "subjectAltName=$san" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
  echo "devbox: generated self-signed certificate ($san)"
fi
chown root:root "$TLS_CRT" "$TLS_KEY"
chmod 600 "$TLS_KEY"
chmod 644 "$TLS_CRT"

# ---- ensure runtime dirs for services ----
mkdir -p /run/user/1000
chown "$WEB_USER:$WEB_USER" /run/user/1000
chmod 700 /run/user/1000
mkdir -p /run/dbus
chown messagebus:messagebus /run/dbus
mkdir -p /var/run/nginx

# ---- Chrome sandbox capability ----
# Docker's default seccomp profile blocks creation of nested user namespaces.
# Probe rather than guess so Chrome keeps its renderer sandbox when supported.
mkdir -p /run/devbox
if su -s /bin/bash "$WEB_USER" -c 'unshare -Ur true' >/dev/null 2>&1; then
  printf 'userns=yes\n' > /run/devbox/caps
  echo 'devbox: user namespaces available; Chrome sandbox enabled'
else
  printf 'userns=no\n' > /run/devbox/caps
  echo 'devbox: user namespaces unavailable; Chrome will use --no-sandbox'
fi
chmod 644 /run/devbox/caps

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf "$@"
