import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, Link, Spinner } from "@heroui/react";
import { Box, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

interface TerminalSession {
  id: string;
  title: string;
  createdAt: number;
  attached: boolean;
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

async function terminalRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/terminal/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function socketUrl(sessionId: string) {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/terminal/ws/sessions/${encodeURIComponent(sessionId)}`;
}

function TerminalPane({
  sessionId,
  active,
  onState,
}: {
  sessionId: string;
  active: boolean;
  onState: (state: ConnectionState) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const onStateRef = useRef(onState);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    let firstConnection = true;
    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 14,
      scrollback: 5000,
      theme: {
        background: "#09090b",
        foreground: "#f4f4f5",
        cursor: "#a1a1aa",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const sendResize = () => {
      const socket = socketRef.current;
      if (
        !activeRef.current ||
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        !container.clientWidth
      )
        return;
      fit.fit();
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    };
    const resizeObserver = new ResizeObserver(() => {
      if (activeRef.current) sendResize();
    });
    resizeObserver.observe(container);

    const connect = () => {
      if (disposed) return;
      onStateRef.current(attempt ? "reconnecting" : "connecting");
      const socket = new WebSocket(socketUrl(sessionId));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        attempt = 0;
        onStateRef.current("connected");
        if (!firstConnection) terminal.reset();
        firstConnection = false;
        sendResize();
        terminal.focus();
      };
      socket.onmessage = async (event) => {
        if (typeof event.data === "string") {
          terminal.write(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(event.data));
        } else if (event.data instanceof Blob) {
          terminal.write(new Uint8Array(await event.data.arrayBuffer()));
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        socketRef.current = null;
        onStateRef.current("reconnecting");
        const delay = Math.min(1000 * 2 ** Math.min(attempt++, 5), 15000);
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    const input = terminal.onData((data) => {
      const socket = socketRef.current;
      if (
        socket?.readyState === WebSocket.OPEN &&
        socket.bufferedAmount < 512 * 1024
      ) {
        socket.send(new TextEncoder().encode(data));
      }
    });
    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      resizeObserver.disconnect();
      input.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fit = fitRef.current;
      if (terminal && fit && containerRef.current?.clientWidth) {
        fit.fit();
        terminal.focus();
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
        }
      }
    });
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={active ? "terminal-pane" : "terminal-pane hidden"}
    />
  );
}

export function TerminalPage() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const initialized = useRef(false);

  const load = useCallback(async () => {
    const result = await terminalRequest<{ sessions: TerminalSession[] }>(
      "/sessions",
    );
    setSessions(result.sessions);
    const current = activeId;
    const nextId = (() => {
      if (current && result.sessions.some((session) => session.id === current))
        return current;
      const saved = window.localStorage.getItem("devbox-active-terminal");
      return saved && result.sessions.some((session) => session.id === saved)
        ? saved
        : (result.sessions[0]?.id ?? null);
    })();
    setActiveId(nextId);
    setTitle(
      result.sessions.find((session) => session.id === nextId)?.title ?? "",
    );
  }, [activeId]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (activeId) {
      window.localStorage.setItem("devbox-active-terminal", activeId);
    }
  }, [activeId]);

  const create = useCallback(async () => {
    setBusy(true);
    try {
      const session = await terminalRequest<TerminalSession>("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: `Terminal ${sessions.length + 1}` }),
      });
      setSessions((current) => [...current, session]);
      setActiveId(session.id);
      setTitle(session.title);
    } finally {
      setBusy(false);
    }
  }, [sessions.length]);

  const detach = (sessionId: string) => {
    const remaining = sessions.filter((session) => session.id !== sessionId);
    setSessions(remaining);
    if (activeId === sessionId) {
      setActiveId(remaining[0]?.id ?? null);
      setTitle(remaining[0]?.title ?? "");
    }
  };

  const remove = async () => {
    if (
      !activeId ||
      !window.confirm("Kill this terminal session and all processes inside it?")
    )
      return;
    setBusy(true);
    try {
      await terminalRequest(`/sessions/${encodeURIComponent(activeId)}`, {
        method: "DELETE",
      });
      detach(activeId);
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!activeId || !title.trim()) return;
    const session = await terminalRequest<TerminalSession>(
      `/sessions/${encodeURIComponent(activeId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title }),
      },
    );
    setSessions((current) =>
      current.map((item) => (item.id === session.id ? session : item)),
    );
  };

  const state = activeId ? (states[activeId] ?? "connecting") : "closed";

  return (
    <div className="flex h-screen min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <Link
          href="/launcher/"
          aria-label="Open the Dashboard"
          className="flex items-center gap-3 text-sm font-semibold tracking-tight text-foreground">
          <Box size={24} className="text-muted" />
          opencode-dev-sanbox
        </Link>
        <div
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Terminal sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex shrink-0 items-center rounded-md ${activeId === session.id ? "bg-zinc-700" : "bg-zinc-800/70"}`}>
              <button
                type="button"
                role="tab"
                aria-selected={activeId === session.id}
                onClick={() => {
                  setActiveId(session.id);
                  setTitle(session.title);
                }}
                className="px-3 py-1.5 text-sm">
                {session.title}
              </button>
              <button
                type="button"
                onClick={() => detach(session.id)}
                className="px-1.5 text-zinc-400 hover:text-white"
                aria-label={`Detach ${session.title}`}
                title="Detach tab; session keeps running">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          isDisabled={busy}
          onPress={() => void create()}>
          <Plus size={15} /> New
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="Refresh sessions"
          onPress={() => void load()}>
          <RefreshCw size={15} />
        </Button>
      </header>
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        {activeId ? (
          <>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void rename()}
              className="w-48 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-zinc-400"
              aria-label="Terminal title"
            />
            <Button size="sm" variant="ghost" onPress={() => void rename()}>
              Rename
            </Button>
            <Button
              size="sm"
              variant="danger"
              isDisabled={busy}
              onPress={() => void remove()}>
              <Trash2 size={14} /> Kill
            </Button>
          </>
        ) : null}
        <Chip
          size="sm"
          variant="soft"
          color={
            state === "connected"
              ? "success"
              : state === "reconnecting"
                ? "warning"
                : "default"
          }>
          {state}
        </Chip>
        <span className="ml-auto text-xs text-zinc-500">
          Closing a tab detaches only. Kill explicitly to stop its processes.
        </span>
      </div>
      <main className="min-h-0 flex-1 p-2">
        {loading ? (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : null}
        {!loading && sessions.length === 0 ? (
          <div className="grid h-full place-items-center gap-3 text-center text-zinc-400">
            <p>No terminal sessions yet.</p>
            <Button variant="primary" onPress={() => void create()}>
              <Plus size={15} /> Create terminal
            </Button>
          </div>
        ) : null}
        {sessions.map((session) => (
          <TerminalPane
            key={session.id}
            sessionId={session.id}
            active={session.id === activeId}
            onState={(next) =>
              setStates((current) => ({ ...current, [session.id]: next }))
            }
          />
        ))}
      </main>
    </div>
  );
}
