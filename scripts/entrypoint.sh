#!/bin/bash
# PID1 entrypoint: seed workspace, secrets, then exec systemd.
set -e

WEB_USER="${WEB_USER:-user}"
WEB_PASSWORD="${WEB_PASSWORD:-changeme}"

# ---- ensure user + home ----
id "$WEB_USER" >/dev/null 2>&1 || {
  useradd -m -u 1000 -G docker,sudo -s /bin/bash "$WEB_USER"
  echo "$WEB_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/99-nopasswd
  chmod 0440 /etc/sudoers.d/99-nopasswd
}
usermod -d /workspace "$WEB_USER" 2>/dev/null || true
mkdir -p /workspace
chown "$WEB_USER:$WEB_USER" /workspace

# Unix password — Cockpit authenticates against PAM
echo "$WEB_USER:$WEB_PASSWORD" | chpasswd

# ---- seed /workspace skeleton (survives empty volume mount) ----
# TigerVNC (Debian trixie) uses $HOME/.config/tigervnc; legacy ~/.vnc only
# triggers a migration that fails on fresh volumes, so seed XDG dir directly.
su -s /bin/bash "$WEB_USER" -c '
  rm -rf "$HOME/.vnc" 2>/dev/null || true
  mkdir -p "$HOME/.config/tigervnc" "$HOME/.local/share"
  if [ ! -f "$HOME/.config/tigervnc/xstartup" ]; then
    cp /usr/share/devbox/xstartup "$HOME/.config/tigervnc/xstartup"
  fi
  chmod +x "$HOME/.config/tigervnc/xstartup"
  if [ ! -f "$HOME/.bashrc" ]; then
    printf "cd /workspace\nPS1=\"\\\\u@\\\\h:\\\\w$ \"\n" > "$HOME/.bashrc"
  fi
  # Screen locker is useless in a VNC session and locks the user out on idle.
  if [ ! -f "$HOME/.config/kscreenlockerrc" ]; then
    printf "[Daemon]\nAutolock=false\nLockOnResume=false\nTimeout=0\n" \
      > "$HOME/.config/kscreenlockerrc"
  fi
  if [ ! -f "$HOME/.config/powermanagementprofilesrc" ]; then
    printf "[AC][SuspendSession]\nidleTime=0\nsuspendType=0\n" \
      > "$HOME/.config/powermanagementprofilesrc"
  fi
'

# ---- nginx basic-auth gate ----
htpasswd -cb /etc/nginx/htpasswd "$WEB_USER" "$WEB_PASSWORD" >/dev/null 2>&1 || true
chmod 644 /etc/nginx/htpasswd

# ---- openchamber env ----
cat > /etc/openchamber.env <<EOF
OPENCHAMBER_UI_PASSWORD=$WEB_PASSWORD
EOF
chmod 600 /etc/openchamber.env

# ---- cockpit.conf (proxy-aware, url root, any http origin) ----
cat > /etc/cockpit/cockpit.conf <<EOF
[WebService]
Origins = http://localhost:8080 http://127.0.0.1:8080 ws://localhost:8080 ws://127.0.0.1:8080
ProtocolHeader = X-Forwarded-Proto
UrlRoot = /cockpit/
AllowUnencrypted = true
LoginTo = false
EOF

# ---- ensure runtime dirs for services ----
mkdir -p /run/user/1000
chown "$WEB_USER:$WEB_USER" /run/user/1000
chmod 700 /run/user/1000
mkdir -p /var/run/nginx /run/cockpit

exec /sbin/init "$@"
