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
  # Arch-Colors provides the desktop chrome while the Dark palette colors Qt
  # applications. Upgrade the old devbox seed (which had no explicit theme),
  # but preserve any theme the user has already selected.
  if [ ! -f "$HOME/.config/lxqt/lxqt.conf" ]; then
    cp /etc/devbox/lxqt.conf "$HOME/.config/lxqt/lxqt.conf"
  elif ! grep -q "^theme=" "$HOME/.config/lxqt/lxqt.conf"; then
    appearance_tmp="$HOME/.config/lxqt/lxqt.conf.devbox-new"
    while IFS= read -r appearance_line; do
      printf "%s\n" "$appearance_line"
      if [ "$appearance_line" = "[General]" ]; then
        printf "theme=Arch-Colors\npalette_override=true\n"
      fi
    done < "$HOME/.config/lxqt/lxqt.conf" > "$appearance_tmp"
    printf "\n[Palette]\n" >> "$appearance_tmp"
    sed -n "/^\[Palette\]$/,/^$/p" /etc/devbox/lxqt.conf | sed "1d" \
      >> "$appearance_tmp"
    mv "$appearance_tmp" "$HOME/.config/lxqt/lxqt.conf"
  fi

  # Restore the previous managed Qt style on workspaces created by the brief
  # alternate-style experiment. Other user-selected styles still win.
  if grep -q "^theme=Arch-Colors$" "$HOME/.config/lxqt/lxqt.conf" \
     && grep -q "^style=kvantum$" "$HOME/.config/lxqt/lxqt.conf"; then
    sed -i "s/^style=kvantum$/style=Fusion/" "$HOME/.config/lxqt/lxqt.conf"
  fi

  # LXQt implements pinned launchers with the quicklaunch panel plugin. Seed
  # the three daily-use apps on a fresh workspace. For a workspace that already
  # has the stock, empty quicklaunch section, add the same defaults once; leave
  # any existing launcher array alone so user ordering/customization wins.
  if [ ! -f "$HOME/.config/lxqt/panel.conf" ]; then
    cp /etc/devbox/lxqt-panel.conf "$HOME/.config/lxqt/panel.conf"
  elif grep -Fxq "[quicklaunch]" "$HOME/.config/lxqt/panel.conf" \
       && ! grep -Fq "apps\\size=" "$HOME/.config/lxqt/panel.conf"; then
    panel_tmp="$HOME/.config/lxqt/panel.conf.devbox-new"
    while IFS= read -r panel_line; do
      printf "%s\n" "$panel_line"
      if [ "$panel_line" = "[quicklaunch]" ]; then
        printf "apps\\\\1\\\\desktop=/usr/share/applications/pcmanfm-qt.desktop\n"
        printf "apps\\\\2\\\\desktop=/usr/share/applications/qterminal.desktop\n"
        printf "apps\\\\3\\\\desktop=/usr/share/applications/google-chrome.desktop\n"
        printf "apps\\\\size=3\n"
      fi
    done < "$HOME/.config/lxqt/panel.conf" > "$panel_tmp"
    mv "$panel_tmp" "$HOME/.config/lxqt/panel.conf"
  fi

  # Some icon themes do not satisfy the fancymenu stylesheet icon lookup. Pin
  # a packaged PNG explicitly (SVG custom icons render blank in LXQt 2.1),
  # while retaining a user-selected icon.
  if grep -Fxq "[fancymenu]" "$HOME/.config/lxqt/panel.conf" \
     && ! grep -q "^ownIcon=" "$HOME/.config/lxqt/panel.conf"; then
    panel_tmp="$HOME/.config/lxqt/panel.conf.devbox-icon"
    while IFS= read -r panel_line; do
      printf "%s\n" "$panel_line"
      if [ "$panel_line" = "[fancymenu]" ]; then
        printf "ownIcon=true\n"
        printf "icon=/usr/share/lxqt/graphics/helix_blue_shadow.png\n"
      fi
    done < "$HOME/.config/lxqt/panel.conf" > "$panel_tmp"
    mv "$panel_tmp" "$HOME/.config/lxqt/panel.conf"
  elif grep -Fq "icon=/usr/share/icons/hicolor/scalable/places/start-here-lxqt.svg" \
       "$HOME/.config/lxqt/panel.conf"; then
    sed -i "s|^icon=/usr/share/icons/hicolor/scalable/places/start-here-lxqt.svg$|icon=/usr/share/lxqt/graphics/helix_blue_shadow.png|" \
      "$HOME/.config/lxqt/panel.conf"
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
