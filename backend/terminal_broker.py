#!/usr/bin/env python3
"""Persistent web terminal broker.

The broker owns only short-lived tmux *client* processes. The tmux server and
its shells are deliberately independent of every WebSocket, so disconnecting a
browser (or restarting this service) does not stop a terminal session.
"""
import asyncio
import json
import os
import re
import secrets
import signal
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

from aiohttp import WSMsgType, web


HOST = os.environ.get("TERMINAL_BIND", "127.0.0.1")
PORT = int(os.environ.get("TERMINAL_PORT", "9105"))
TMUX = "/usr/bin/tmux"
SOCKET_DIR = "/run/user/1000/devbox-terminal"
SOCKET = os.path.join(SOCKET_DIR, "tmux.sock")
WORKSPACE = "/workspace"
AUTH_URL = "http://127.0.0.1:9102/api/v1/authorize"
SESSION_RE = re.compile(r"^term-[a-f0-9]{12}$")
MAX_SESSIONS = 32
MAX_TITLE = 80
MAX_INPUT = 128 * 1024
MAX_CONTROL = 4096
MAX_COLS = 500
MAX_ROWS = 200


def safe_title(value: object, default: str = "Terminal") -> str:
    title = str(value or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")
    title = " ".join(title.split()).strip()[:MAX_TITLE]
    return title or default


def tmux_run(*args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [TMUX, "-S", SOCKET, *args],
        cwd=WORKSPACE,
        env={**os.environ, "HOME": WORKSPACE, "TMUX_TMPDIR": "/run/user/1000"},
        capture_output=True,
        text=True,
        timeout=8,
        check=check,
    )


async def tmux(*args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return await asyncio.to_thread(tmux_run, *args, check=check)


def auth_check(cookie: str) -> Optional[bool]:
    """Return True/False; None means the control plane is temporarily down."""
    if not cookie:
        return False
    request = urllib.request.Request(AUTH_URL, headers={"Cookie": cookie})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return 200 <= response.status < 300
    except urllib.error.HTTPError as error:
        return False if error.code in (401, 403) else None
    except (OSError, urllib.error.URLError):
        return None


def origin_allowed(request: web.Request) -> bool:
    origin = request.headers.get("Origin")
    if not origin:
        return request.method in {"GET", "HEAD"}
    expected = f"{request.headers.get('X-Forwarded-Proto', request.scheme)}://{request.headers.get('Host', '')}"
    return origin.rstrip("/") == expected.rstrip("/")


async def has_session(session_id: str) -> bool:
    if not SESSION_RE.fullmatch(session_id):
        return False
    result = await tmux("has-session", "-t", session_id)
    return result.returncode == 0


async def session_rows() -> list[dict[str, object]]:
    result = await tmux(
        "list-sessions",
        "-F",
        "#{session_name}\t#{session_created}\t#{@devbox-title}",
    )
    if result.returncode != 0:
        return []
    rows = []
    for line in result.stdout.splitlines():
        fields = line.split("\t", 2)
        if len(fields) != 3:
            continue
        session_id, created, title = fields
        if not SESSION_RE.fullmatch(session_id):
            continue
        try:
            created_at = int(created)
        except ValueError:
            created_at = int(time.time())
        rows.append(
            {
                "id": session_id,
                "title": safe_title(title),
                "createdAt": created_at,
                "attached": session_id in attachments,
            }
        )
    return rows


def set_winsize(fd: int, cols: int, rows: int) -> None:
    import fcntl
    import struct
    import termios

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


@dataclass
class Attachment:
    session_id: str
    ws: web.WebSocketResponse
    fd: int
    pid: int
    loop: asyncio.AbstractEventLoop
    output: asyncio.Queue[bytes]
    closed: bool = False
    paused: bool = False
    pump_task: Optional[asyncio.Task[None]] = None
    wait_task: Optional[asyncio.Task[None]] = None
    auth_task: Optional[asyncio.Task[None]] = None

    def start(self) -> None:
        os.set_blocking(self.fd, False)
        self.loop.add_reader(self.fd, self._read_ready)
        self.pump_task = asyncio.create_task(self._pump_output())
        self.wait_task = asyncio.create_task(self._wait_child())

    def _read_ready(self) -> None:
        if self.closed:
            return
        try:
            data = os.read(self.fd, 64 * 1024)
        except BlockingIOError:
            return
        except OSError:
            asyncio.create_task(self.close(1011))
            return
        if not data:
            asyncio.create_task(self.close(1000))
            return
        try:
            self.output.put_nowait(data)
        except asyncio.QueueFull:
            self.paused = True
            self.loop.remove_reader(self.fd)

    async def _pump_output(self) -> None:
        try:
            while not self.closed:
                data = await self.output.get()
                await self.ws.send_bytes(data)
                if self.paused and self.output.qsize() < 64 and not self.closed:
                    self.paused = False
                    self.loop.add_reader(self.fd, self._read_ready)
        except (ConnectionError, RuntimeError, asyncio.CancelledError):
            if not self.closed:
                await self.close(1001)

    async def _wait_child(self) -> None:
        try:
            await asyncio.to_thread(os.waitpid, self.pid, 0)
        except (ChildProcessError, asyncio.CancelledError):
            return
        if not self.closed:
            await self.close(1000)

    async def watch_auth(self, cookie: str) -> None:
        while not self.closed:
            await asyncio.sleep(30)
            result = await asyncio.to_thread(auth_check, cookie)
            if result is False:
                await self.close(1008)
                return

    async def write(self, data: bytes) -> None:
        if self.closed or len(data) > MAX_INPUT:
            raise ValueError("input too large")

        def write_all() -> None:
            view = memoryview(data)
            while view:
                written = os.write(self.fd, view)
                view = view[written:]

        await asyncio.wait_for(asyncio.to_thread(write_all), timeout=2)

    async def resize(self, cols: int, rows: int) -> None:
        if not (1 <= cols <= MAX_COLS and 1 <= rows <= MAX_ROWS):
            raise ValueError("invalid terminal size")
        await asyncio.to_thread(set_winsize, self.fd, cols, rows)

    async def close(self, code: int = 1000) -> None:
        if self.closed:
            return
        self.closed = True
        self.loop.remove_reader(self.fd)
        try:
            os.close(self.fd)
        except OSError:
            pass
        if self.pid > 0:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        current = asyncio.current_task()
        if self.wait_task and self.wait_task is not current:
            try:
                await asyncio.wait_for(asyncio.shield(self.wait_task), timeout=1)
            except (asyncio.TimeoutError, asyncio.CancelledError, ChildProcessError):
                pass
        if self.pump_task and self.pump_task is not current:
            self.pump_task.cancel()
        if self.auth_task and self.auth_task is not current:
            self.auth_task.cancel()
        if not self.ws.closed:
            try:
                await self.ws.close(code=code)
            except (ConnectionError, RuntimeError):
                pass


attachments: dict[str, Attachment] = {}
session_lock = asyncio.Lock()


async def create_session(title: str) -> dict[str, object]:
    async with session_lock:
        if len(await session_rows()) >= MAX_SESSIONS:
            raise web.HTTPTooManyRequests(text="too many terminal sessions")
        session_id = "term-" + secrets.token_hex(6)
        result = await tmux(
            "new-session",
            "-d",
            "-s",
            session_id,
            "-c",
            WORKSPACE,
            "/bin/bash",
            "-l",
        )
        if result.returncode != 0:
            raise web.HTTPInternalServerError(text="could not create terminal session")
        await tmux("set-option", "-t", session_id, "status", "off")
        await tmux("set-option", "-t", session_id, "@devbox-title", safe_title(title))
        rows = await session_rows()
        return next(row for row in rows if row["id"] == session_id)


async def delete_session(session_id: str) -> None:
    async with session_lock:
        attachment = attachments.pop(session_id, None)
        if attachment:
            await attachment.close(1000)
        result = await tmux("kill-session", "-t", session_id)
        if result.returncode != 0 and await has_session(session_id):
            raise web.HTTPInternalServerError(text="could not delete terminal session")


async def json_body(request: web.Request) -> dict[str, object]:
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        raise web.HTTPBadRequest(text="invalid JSON")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="JSON object required")
    return body


async def list_handler(_: web.Request) -> web.Response:
    return web.json_response({"sessions": await session_rows()})


async def create_handler(request: web.Request) -> web.Response:
    body = await json_body(request)
    return web.json_response(await create_session(safe_title(body.get("title"), "Terminal")), status=201)


async def rename_handler(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    if not await has_session(session_id):
        raise web.HTTPNotFound(text="terminal session not found")
    body = await json_body(request)
    title = safe_title(body.get("title"), "Terminal")
    result = await tmux("set-option", "-t", session_id, "@devbox-title", title)
    if result.returncode != 0:
        raise web.HTTPInternalServerError(text="could not rename terminal session")
    return web.json_response(next(row for row in await session_rows() if row["id"] == session_id))


async def delete_handler(request: web.Request) -> web.Response:
    session_id = request.match_info["session_id"]
    if not SESSION_RE.fullmatch(session_id):
        raise web.HTTPNotFound(text="terminal session not found")
    await delete_session(session_id)
    return web.json_response({"ok": True})


async def attach(request: web.Request) -> web.WebSocketResponse:
    session_id = request.match_info["session_id"]
    if not await has_session(session_id):
        raise web.HTTPNotFound(text="terminal session not found")
    ws = web.WebSocketResponse(
        heartbeat=25,
        receive_timeout=None,
        max_msg_size=MAX_INPUT,
        writer_limit=64 * 1024,
    )
    await ws.prepare(request)
    loop = asyncio.get_running_loop()
    pid, fd = os.forkpty()
    if pid == 0:
        os.environ.update(HOME=WORKSPACE, TERM="xterm-256color", TMUX_TMPDIR="/run/user/1000")
        os.chdir(WORKSPACE)
        os.execv(TMUX, [TMUX, "-S", SOCKET, "attach-session", "-t", session_id])
        raise RuntimeError("exec failed")

    attachment = Attachment(session_id, ws, fd, pid, loop, asyncio.Queue(maxsize=128))
    async with session_lock:
        old = attachments.get(session_id)
        attachments[session_id] = attachment
    if old:
        await old.close(4000)
    attachment.start()
    attachment.auth_task = asyncio.create_task(attachment.watch_auth(request.headers.get("Cookie", "")))
    try:
        async for message in ws:
            if message.type == WSMsgType.BINARY:
                await attachment.write(message.data)
            elif message.type == WSMsgType.TEXT:
                if len(message.data) > MAX_CONTROL:
                    await ws.close(code=1009, message=b"control frame too large")
                    break
                try:
                    control = json.loads(message.data)
                except json.JSONDecodeError:
                    await ws.close(code=1003, message=b"invalid control frame")
                    break
                if control.get("type") != "resize":
                    await ws.close(code=1003, message=b"unknown control frame")
                    break
                await attachment.resize(int(control["cols"]), int(control["rows"]))
            elif message.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                break
    except (ConnectionError, OSError, ValueError, KeyError, TypeError, asyncio.TimeoutError):
        pass
    finally:
        if attachments.get(session_id) is attachment:
            attachments.pop(session_id, None)
        await attachment.close(1000)
    return ws


async def cleanup(app: web.Application) -> None:
    await asyncio.gather(*(attachment.close(1001) for attachment in list(attachments.values())))
    attachments.clear()


def detach_orphaned_clients() -> None:
    """Drop attach clients left behind by an ungraceful broker crash."""
    result = tmux_run("list-clients", "-F", "#{client_tty}")
    if result.returncode != 0:
        return
    for client_tty in result.stdout.splitlines():
        if client_tty:
            tmux_run("kill-client", "-t", client_tty)


def make_app() -> web.Application:
    @web.middleware
    async def request_guard(request: web.Request, handler):
        if request.path.startswith(("/api/", "/ws/")) and not origin_allowed(request):
            raise web.HTTPForbidden(text="origin not allowed")
        return await handler(request)

    app = web.Application(middlewares=[request_guard], client_max_size=MAX_INPUT)
    app.router.add_get("/api/sessions", list_handler)
    app.router.add_post("/api/sessions", create_handler)
    app.router.add_patch("/api/sessions/{session_id}", rename_handler)
    app.router.add_delete("/api/sessions/{session_id}", delete_handler)
    app.router.add_get("/ws/sessions/{session_id}", attach)
    app.cleanup_ctx.append(lambda _: _cleanup_context())
    return app


async def _cleanup_context():
    yield
    await cleanup(None)  # type: ignore[arg-type]


if __name__ == "__main__":
    os.makedirs(SOCKET_DIR, mode=0o700, exist_ok=True)
    os.chmod(SOCKET_DIR, 0o700)
    detach_orphaned_clients()
    web.run_app(make_app(), host=HOST, port=PORT, print=None)
