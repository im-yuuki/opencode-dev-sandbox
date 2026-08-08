#!/usr/bin/env python3
import http.server, json, os, pathlib, urllib.parse

ROOT = os.path.join(os.path.dirname(__file__), "dist")
PORT = int(os.environ.get("PORT", "4399"))

MIME = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
    ".json": "application/json", ".woff2": "font/woff2",
}

GROUPS = [ 
    {"id": "desktop", "name": "Desktop (KDE Plasma)", "protected": False,
     "members": [
         {"unit": "vnc.service", "name": "Xvnc + Plasma", "running": False},
         {"unit": "websockify.service", "name": "noVNC bridge", "running": False},
     ]},
    {"id": "terminal", "name": "Terminal (ttyd)", "protected": False,
     "members": [{"unit": "ttyd.service", "name": "web shell", "running": True}]},
    {"id": "cockpit", "name": "Cockpit", "protected": False,
     "members": [{"unit": "cockpit.socket", "name": "web admin", "running": True}]},
    {"id": "gateway", "name": "Gateway + control plane", "protected": True,
     "members": [
         {"unit": "nginx.service", "name": "gateway", "running": True},
         {"unit": "devbox-api.service", "name": "control plane", "running": True},
     ]},
]


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, _fmt, *_args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        if p == "/api/v1/boot":
            return self._json({"authed": True, "needsSetup": False, "user": "user"})
        if p == "/api/v1/services":
            return self._json({"groups": GROUPS})
        rel = p.removeprefix("/ui").lstrip("/") or "index.html"
        fp = os.path.normpath(os.path.join(ROOT, rel))
        if not fp.startswith(ROOT) or not os.path.isfile(fp):
            fp = os.path.join(ROOT, "index.html")
        data = pathlib.Path(fp).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(pathlib.Path(fp).suffix, "text/html"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self._json({"ok": True, "running": True})


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"serving {ROOT} on :{PORT}")
    srv.serve_forever()