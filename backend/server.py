#!/usr/bin/env python3
"""DevBox control plane.

Single-process ThreadingHTTPServer bound to 127.0.0.1, used by nginx as:
  * a PAM authentication + session backend (replaces HTTP basic auth)
  * a supervisor service-toggling control API.

Runs as root so it can read /etc/shadow (PAM) and drive supervisorctl.
"""
import http.server
import json
import os
import secrets
import subprocess
import threading
import time
import urllib.parse

USER = os.environ.get("DEVBOX_USER", "user")
HOST = os.environ.get("DEVBOX_BIND", "127.0.0.1")
PORT = int(os.environ.get("DEVBOX_PORT", "9102"))
SESSION_TTL = 60 * 60 * 12  # 12h

# Where the dashboard persists which applications the user turned on, so they
# come back after a container restart (the volume survives both `docker stop`
# and `run.sh`'s rm + run; a bare container filesystem would not).
STATE_DIR = "/workspace/.devbox"
STATE_FILE = os.path.join(STATE_DIR, "apps.json")

# Applications shown on the dashboard. id -> (display name, [supervisor
# programs]). nginx (gateway) and dbus stay supervised but are never listed:
# the gateway cannot be toggled (stopping it locks everyone out) and dbus is
# session infrastructure. "agent" is the core app: always autostarted, never
# offered Launch/Stop controls.
# Desktop = one feature: Xvnc + Plasma (vnc) toggled together with its
# noVNC bridge (websockify) so the pair stays consistent.
APPS = {
    "agent": ("Agent", [("openchamber", "OpenCode UI + terminal")]),
    "desktop": (
        "Desktop",
        [("vnc", "Xvnc + Plasma"), ("websockify", "noVNC bridge")],
    ),
    "code": ("Code", [("code-server", "VS Code web")]),
    "docker": ("Docker", [("docker", "nested daemon (DinD)")]),
}
ACTIONS = {"start", "stop", "restart"}

sessions = {}
_lock = threading.Lock()


# ---------------- pam / shadow ----------------
def pam_authenticate(password: str) -> bool:
    """Authenticate USER against Linux PAM (pam_unix via shadow)."""
    try:
        import pamela

        pamela.authenticate(USER, password, service="login")
        return True
    except pamela.PAMError:
        return False
    except Exception:
        return False


def password_locked() -> bool:
    """True when the account has no usable password (first-visit setup).

    Python 3.13 dropped the spwd module, so parse /etc/shadow directly
    (the API runs as root).
    """
    try:
        with open("/etc/shadow", encoding="utf-8", errors="replace") as f:
            for line in f:
                name, pwfield, *_ = line.rstrip("\n").split(":")
                if name == USER:
                    return not pwfield or pwfield.startswith(("!", "*"))
    except Exception:
        pass
    return True


def set_password(password: str) -> bool:
    """Set the Unix password for USER (chpasswd). Refuses if already set."""
    if not password_locked():
        return False
    p = subprocess.run(
        ["chpasswd"], input=f"{USER}:{password}\n", text=True, capture_output=True
    )
    return p.returncode == 0


# ---------------- sessions ----------------
def new_session() -> str:
    token = secrets.token_urlsafe(24)
    with _lock:
        sessions[token] = {"user": USER, "exp": time.time() + SESSION_TTL}
    return token


def session_user(token):
    if not token:
        return None
    with _lock:
        s = sessions.get(token)
    if not s:
        return None
    if s["exp"] < time.time():
        with _lock:
            sessions.pop(token, None)
        return None
    return s["user"]


def drop_session(token):
    with _lock:
        sessions.pop(token, None)


# ---------------- supervisor ----------------
SUPERVISORCTL = ["supervisorctl", "-c", "/etc/supervisor/supervisord.conf"]


def is_active(prog: str) -> bool:
    r = subprocess.run(
        [*SUPERVISORCTL, "status", prog], capture_output=True, text=True
    )
    return r.returncode == 0 and "RUNNING" in r.stdout


def svc_action(prog: str, action: str) -> bool:
    # Idempotent: starting a running program (or stopping a stopped one) is a
    # no-op success, mirroring systemctl's behavior.
    if action == "start" and is_active(prog):
        return True
    if action == "stop" and not is_active(prog):
        return True
    r = subprocess.run([*SUPERVISORCTL, action, prog], capture_output=True, text=True)
    return r.returncode == 0


# ---------------- app enablement (survives container restart) ----------------
def load_enabled() -> set:
    """Ids of applications the user has turned on. Missing/corrupt -> empty."""
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return set()
    return {a for a in data.get("enabled", []) if a in APPS}


def save_enabled(enabled: set) -> None:
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"enabled": sorted(enabled)}, f, indent=2)
    except Exception:
        pass


def restore_enabled() -> None:
    """Start every app that was enabled before the container restarted."""
    for app_id in load_enabled():
        for prog, _ in APPS[app_id][1]:
            svc_action(prog, "start")


# ---------------- http ----------------
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # helpers
    def _send(self, obj, code=200, cookie=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        # Set-Cookie must be emitted after send_response(), otherwise it is
        # written into the header buffer ahead of the status line.
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _plain(self, text: str, code=200):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cookie_token(self):
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            k, _, v = part.strip().partition("=")
            if k == "devbox_session":
                return v
        return None

    # Secure is unconditional: the gateway is https-only, so a cleartext
    # request never gets far enough to need the cookie back.
    @staticmethod
    def _session_cookie(token):
        return (
            f"devbox_session={token}; Path=/; HttpOnly; Secure; SameSite=Lax; "
            f"Max-Age={SESSION_TTL}"
        )

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def _authed_user(self):
        return session_user(self._cookie_token())

    def send_error(self, code, message=None, explain=None):
        try:
            self._plain("error", code)
        except Exception:
            pass

    # routes
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/v1/authorize":
            if self._authed_user():
                return self._plain("ok", 200)
            return self._plain("", 401)
        if path == "/api/v1/boot":
            user = self._authed_user()
            return self._send(
                {"authed": bool(user), "needsSetup": password_locked(), "user": user}
            )
        if path == "/api/v1/services":
            if not self._authed_user():
                return self._send({"error": "unauthorized"}, 401)
            return self._send(
                {
                    "apps": [
                        {
                            "id": app_id,
                            "name": name,
                            "running": all(is_active(p) for p, _ in members),
                            "members": [
                                {"unit": prog, "name": label, "running": is_active(prog)}
                                for prog, label in members
                            ],
                        }
                        for app_id, (name, members) in APPS.items()
                    ]
                }
            )
        return self._plain("not found", 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self._body()

        if path == "/api/v1/setup":
            pw = str(body.get("password") or "")
            if len(pw) < 6:
                return self._send({"error": "password too short"}, 400)
            if not password_locked():
                return self._send({"error": "already configured"}, 409)
            if not set_password(pw):
                return self._send({"error": "failed to set password"}, 500)
            token = new_session()
            return self._send(
                {"user": USER, "ok": True}, cookie=self._session_cookie(token)
            )

        if path == "/api/v1/login":
            pw = str(body.get("password") or "")
            if password_locked():
                return self._send({"error": "password must be set first"}, 409)
            if not pam_authenticate(pw):
                return self._send({"error": "invalid credentials"}, 401)
            token = new_session()
            return self._send(
                {"user": USER, "ok": True}, cookie=self._session_cookie(token)
            )

        if path == "/api/v1/logout":
            drop_session(self._cookie_token())
            return self._send(
                {"ok": True},
                cookie="devbox_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
            )

        if path.startswith("/api/v1/services/"):
            if not self._authed_user():
                return self._send({"error": "unauthorized"}, 401)
            rest = path[len("/api/v1/services/"):].split("/")
            if len(rest) != 2:
                return self._send({"error": "bad request"}, 400)
            app_id, action = rest
            if app_id not in APPS or action not in ACTIONS:
                return self._send({"error": "unknown application or action"}, 400)
            members = APPS[app_id][1]
            # Persist enablement so Launch survives a container restart; stop
            # clears it. restart leaves the saved state untouched.
            enabled = load_enabled()
            if action == "start":
                enabled.add(app_id)
                save_enabled(enabled)
            elif action == "stop":
                enabled.discard(app_id)
                save_enabled(enabled)
            for prog, _ in members:
                if not svc_action(prog, action):
                    return self._send(
                        {"error": f"supervisorctl {action} {prog} failed"}, 500
                    )
            return self._send(
                {
                    "id": app_id,
                    "running": all(is_active(p) for p, _ in members),
                }
            )

        return self._plain("not found", 404)


def main():
    # Bring back applications that were enabled before the container restarted.
    # Agent and infrastructure (nginx, dbus) autostart via supervisord instead.
    restore_enabled()
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"devbox api listening on {HOST}:{PORT} for user '{USER}'", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
