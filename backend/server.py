#!/usr/bin/env python3
"""DevBox control plane.

Single-process ThreadingHTTPServer bound to 127.0.0.1, used by nginx as:
  * a PAM authentication + session backend (replaces HTTP basic auth)
  * a systemd service-toggling control API.

Runs as root so it can read /etc/shadow (PAM) and drive systemctl.
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
PORT = int(os.environ.get("DEVBOX_PORT", "3100"))
SESSION_TTL = 60 * 60 * 12  # 12h

# id -> (unit, human-readable name)
SERVICES = {
    "openchamber": ("openchamber.service", "OpenChamber"),
    "desktop": ("vnc.service", "Desktop (VNC)"),
    "novnc": ("websockify.service", "noVNC bridge"),
    "terminal": ("ttyd.service", "Web terminal (ttyd)"),
    "cockpit": ("cockpit.socket", "Cockpit"),
    "nginx": ("nginx.service", "Web gateway"),
    "docker": ("docker.service", "Docker daemon"),
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


# ---------------- systemd ----------------
def is_active(unit: str) -> bool:
    r = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True)
    return r.returncode == 0


def systemctl_action(unit: str, action: str) -> bool:
    r = subprocess.run(["systemctl", action, unit], capture_output=True, text=True)
    return r.returncode == 0


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

    @staticmethod
    def _session_cookie(token):
        return (
            f"devbox_session={token}; Path=/; HttpOnly; SameSite=Lax; "
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
            svcs = []
            for sid, (unit, name) in SERVICES.items():
                svcs.append(
                    {"id": sid, "name": name, "unit": unit, "running": is_active(unit)}
                )
            return self._send({"services": svcs})
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
                cookie="devbox_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            )

        if path.startswith("/api/v1/services/"):
            if not self._authed_user():
                return self._send({"error": "unauthorized"}, 401)
            rest = path[len("/api/v1/services/"):].split("/")
            if len(rest) != 2:
                return self._send({"error": "bad request"}, 400)
            sid, action = rest
            if sid not in SERVICES or action not in ACTIONS:
                return self._send({"error": "unknown service or action"}, 400)
            unit = SERVICES[sid][0]
            if not systemctl_action(unit, action):
                return self._send({"error": f"systemctl {action} failed"}, 500)
            return self._send({"id": sid, "running": is_active(unit)})

        return self._plain("not found", 404)


def main():
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"devbox api listening on {HOST}:{PORT} for user '{USER}'", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
