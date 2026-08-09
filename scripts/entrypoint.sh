#!/bin/bash
# PID1 entrypoint: seed workspace, secrets, then exec supervisord.
set -e

# Fixed, matching the Dockerfile: the control plane (DEVBOX_USER), the
# supervisor programs and /run/user/1000 all assume this account.
WEB_USER=user

# ---- 1. ensure user + home ----
# Member of the sudo group, but with no sudoers drop-in: escalation uses the
# real /usr/bin/sudo and the Unix password the user sets on first visit through
# the web UI. Until that setup completes the account is locked and sudo cannot
# be used at all.
id "$WEB_USER" >/dev/null 2>&1 || {
  useradd -m -u 1000 -G sudo -s /bin/bash "$WEB_USER"
}
usermod -d /workspace "$WEB_USER" 2>/dev/null || true

# ---- 3. workspace ownership ----
mkdir -p /workspace
chown "$WEB_USER:$WEB_USER" /workspace

# ---- 4. managed shell setup ----
# Colored prompt/ls/grep live in /etc/devbox/bashrc; ~/.bashrc only gets a
# one-line source guarded by a marker. An existing .bashrc is never replaced,
# and because the block is appended, anything the user defines after it still
# wins. Workspaces created by an older image pick this up on the next start.
SHELL_MARKER='# devbox managed shell setup'
su -s /bin/bash "$WEB_USER" -c '
  marker="'"$SHELL_MARKER"'"
  if [ ! -f "$HOME/.bashrc" ]; then
    : > "$HOME/.bashrc"
  fi
  if ! grep -Fq "$marker" "$HOME/.bashrc"; then
    {
      printf "\n%s\n" "$marker"
      printf "%s\n" "[ -f /etc/devbox/bashrc ] && . /etc/devbox/bashrc"
    } >> "$HOME/.bashrc"
  fi
'
# Colored git output for every account, including root via sudo. Written to the
# system gitconfig so a user-level color.ui setting still overrides it.
git config --system color.ui auto 2>/dev/null || true

# ---- 4b. OpenCode out-of-the-box config ----
# Seeded once into the user's global OpenCode config. Written only when neither
# opencode.jsonc nor opencode.json exists, so a config the user has edited (or
# one restored with an older workspace volume) is never clobbered. HOME is
# /workspace, so this lands on the persistent volume and survives a rebuild.
su -s /bin/bash "$WEB_USER" -c '
  oc_dir="$HOME/.config/opencode"
  mkdir -p "$oc_dir"
  if [ ! -f "$oc_dir/opencode.jsonc" ] && [ ! -f "$oc_dir/opencode.json" ]; then
    cp /etc/devbox/opencode.jsonc "$oc_dir/opencode.jsonc"
    echo "devbox: seeded OpenCode config"
  fi
'

# ---- 5. seed /workspace skeleton (survives empty volume mount) ----
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

# ---- 6. FileBrowser state ----
# Idempotent: the directories are re-asserted every start, but config.yaml is
# written once. After first run that file belongs to the user.
FB_DIR=/workspace/.devbox/filebrowser
install -d -o "$WEB_USER" -g "$WEB_USER" -m 700 "$FB_DIR"
install -d -o "$WEB_USER" -g "$WEB_USER" -m 700 "$FB_DIR/cache"
if [ ! -f "$FB_DIR/config.yaml" ]; then
  install -o "$WEB_USER" -g "$WEB_USER" -m 600 \
    /etc/devbox/filebrowser.yaml "$FB_DIR/config.yaml"
  echo "devbox: seeded FileBrowser config"
fi
# The database is created by FileBrowser itself on first start and only needs a
# writable parent. Re-assert ownership (never contents) so a workspace written
# by an older image stays usable by uid 1000.
if [ -e "$FB_DIR/database.db" ]; then
  chown "$WEB_USER:$WEB_USER" "$FB_DIR/database.db"
fi

# ---- 7. CLIProxyAPI state ----
# 0700 throughout: this tree holds the management key, provider OAuth tokens
# and any proxy API keys the user mints from the panel.
CP_DIR=/workspace/.devbox/cliproxy
CP_KEY="$CP_DIR/management.key"
install -d -o "$WEB_USER" -g "$WEB_USER" -m 700 "$CP_DIR"
install -d -o "$WEB_USER" -g "$WEB_USER" -m 700 "$CP_DIR/auth"
install -d -o "$WEB_USER" -g "$WEB_USER" -m 700 "$CP_DIR/logs"
install -d -o "$WEB_USER" -g "$WEB_USER" -m 700 "$CP_DIR/plugins"

if [ ! -s "$CP_KEY" ]; then
  # 32 bytes from the kernel CSPRNG, base64url so it pastes cleanly into the
  # panel's login field.
  (umask 077; openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > "$CP_KEY")
  chown "$WEB_USER:$WEB_USER" "$CP_KEY"
  echo "devbox: generated CLIProxyAPI management key"
fi
chmod 600 "$CP_KEY"

# Seeded only when no config exists at all. CLIProxyAPI bcrypt-hashes the key
# and rewrites this file on startup, and the Management Center stores provider
# credentials in it, so re-seeding would destroy both.
if [ ! -f "$CP_DIR/config.yaml" ]; then
  cp_tmp="$CP_DIR/config.yaml.devbox-new"
  # awk on a fixed placeholder: a key containing sed delimiters or regex
  # metacharacters cannot corrupt the output.
  (umask 077; awk -v key="$(cat "$CP_KEY")" \
    '{ gsub(/__DEVBOX_MANAGEMENT_KEY__/, key); print }' \
    /etc/devbox/cliproxy.yaml > "$cp_tmp")
  chown "$WEB_USER:$WEB_USER" "$cp_tmp"
  chmod 600 "$cp_tmp"
  mv "$cp_tmp" "$CP_DIR/config.yaml"
  echo "devbox: seeded CLIProxyAPI config"
fi

# Tighten existing auth tokens without touching their contents, in case they
# were written by an older image with a laxer umask.
find "$CP_DIR/auth" -type f -exec chmod 600 {} + 2>/dev/null || true

# ---- 8. TLS: self-signed cert, generated once on first run ----
# Lives on the /workspace volume so the browser's trust exception survives a
# container rebuild; delete the directory to force a new pair. The key stays
# root-owned 0600: nginx reads it as root before dropping privileges, and no
# process running as `user` has any reason to open it.
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

# ---- 9. ensure runtime dirs for services ----
mkdir -p /run/user/1000
chown "$WEB_USER:$WEB_USER" /run/user/1000
chmod 700 /run/user/1000
mkdir -p /run/dbus
chown messagebus:messagebus /run/dbus
mkdir -p /var/run/nginx

# ---- 10. Chrome sandbox capability ----
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

# ---- 11. hand off to supervisor as PID 1 ----
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf "$@"
