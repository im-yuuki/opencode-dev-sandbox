import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button, Spinner, buttonVariants } from "@heroui/react";
import {
  LogOut,
  ExternalLink,
  Frame,
  RefreshCw,
  Power,
  Box,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { api, type GroupInfo } from "../api";
import { TOOLS } from "../tools";

function useGroups() {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // `tick` is the reload key: bumping it re-runs the fetch. State lands in the
  // promise callback rather than the effect body, and `alive` drops responses
  // from a superseded run.
  useEffect(() => {
    let alive = true;
    void api
      .services()
      .then((r) => alive && setGroups(r.groups))
      .catch(() => {
        /* keep last state */
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const act = useCallback(
    async (g: GroupInfo, action: "start" | "stop" | "restart") => {
      setBusyId(g.id);
      try {
        await api.serviceAction(g.id, action);
      } catch {
        /* keep UI stable */
      } finally {
        setBusyId(null);
        refresh();
      }
    },
    [refresh]
  );

  return { groups, busyId, act, refresh };
}

const groupRunning = (g: GroupInfo) => g.members.length > 0 && g.members.every((m) => m.running);

function GroupCard({
  g,
  busy,
  onAction,
}: {
  g: GroupInfo;
  busy: boolean;
  onAction: (a: "start" | "stop" | "restart") => void;
}) {
  const running = groupRunning(g);
  const someOn = g.members.some((m) => m.running);
  return (
    <div className="devbox-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {g.protected ? (
            <Lock size={14} className="devbox-muted" aria-label="protected" />
          ) : (
            <span
              className={`dot-toggle ${running ? "bg-emerald-500" : someOn ? "bg-amber-400" : "bg-zinc-300 dark:bg-zinc-600"}`}
              aria-label={running ? "running" : "stopped"}
            />
          )}
          <span className="text-sm font-medium">{g.name}</span>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="refresh status"
          onPress={() => onAction("restart")}
        >
          <RefreshCw size={14} />
        </Button>
      </div>

      <ul className="devbox-muted flex flex-col gap-1 text-xs">
        {g.members.map((m) => (
          <li key={m.unit} className="flex items-center gap-2">
            <span
              className={`dot-toggle ${m.running ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
            />
            <span className="font-mono">{m.unit}</span>
            <span>{m.name}</span>
          </li>
        ))}
      </ul>

      {g.protected ? (
        <p className="devbox-muted text-xs">always on · locks the whole box if stopped</p>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={running ? "danger" : "primary"}
            isDisabled={busy}
            isPending={busy}
            onPress={() => onAction(running ? "stop" : "start")}
            className="flex-1"
          >
            {({ isPending }) => (
              <>
                {isPending ? <Spinner color="current" size="sm" /> : null}
                {running ? "Stop" : "Start"}
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            isDisabled={busy || !someOn}
            onPress={() => onAction("restart")}
            className="flex-1"
          >
            Restart
          </Button>
        </div>
      )}
    </div>
  );
}

function ToolCard({
  id,
  name,
  description,
  icon: Icon,
  url,
  embed,
}: {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  url: string;
  embed: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="devbox-card flex flex-col gap-3 p-5"
    >
      <div className="flex items-center gap-3">
        <span className="devbox-chip p-2">
          <Icon size={18} />
        </span>
        <div>
          <div className="text-sm font-medium">{name}</div>
          <div className="devbox-muted text-xs">{description}</div>
        </div>
      </div>
      <div className="mt-auto flex gap-2">
        <a
          href={embed ? `/ui/embed/${id}` : undefined}
          aria-disabled={!embed}
          className={buttonVariants({
            variant: "primary",
            size: "sm",
            className: embed ? undefined : "pointer-events-none opacity-50",
          })}
        >
          <Frame size={14} />
          Embed
        </a>
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink size={14} />
          Open
        </a>
      </div>
    </motion.div>
  );
}

export function Dashboard({ user }: { user: string }) {
  const { groups, busyId, act } = useGroups();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-[#fafafa]/85 backdrop-blur dark:border-zinc-800 dark:bg-[#101114]/85">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Box size={16} className="text-zinc-500 dark:text-zinc-400" />
            DevBox
          </div>
          <div className="flex items-center gap-3">
            <span className="devbox-label">{user}</span>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="sign out"
              onPress={() => void api.logout().then(() => window.location.reload())}
            >
              <LogOut size={15} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <section className="mb-10">
          <div className="devbox-label mb-3">tools</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TOOLS.map((t) => (
              <ToolCard key={t.id} {...t} />
            ))}
          </div>
        </section>

        <section>
          <div className="devbox-label mb-3">services · grouped by feature</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <GroupCard key={g.id} g={g} busy={busyId === g.id} onAction={(a) => void act(g, a)} />
            ))}
          </div>
          <p className="devbox-muted mt-3 flex items-center gap-2 text-xs">
            <Power size={12} />
            A group acts on all of its units together, so paired features (e.g. the Plasma
            desktop and its noVNC bridge) stay consistent.
          </p>
        </section>
      </main>
    </div>
  );
}
