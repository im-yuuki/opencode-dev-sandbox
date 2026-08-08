import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import {
  Avatar,
  Button,
  Card,
  Chip,
  Header,
  Separator,
  Spinner,
  Typography,
  buttonVariants,
} from "@heroui/react";
import {
  ArrowUpRight,
  Frame,
  LogOut,
  RefreshCw,
  Rocket,
  Box,
  type LucideIcon,
} from "lucide-react";
import { api, type AppInfo } from "../api";
import { TOOLS } from "../tools";

function useApps() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // `tick` is the reload key: bumping it re-runs the fetch. State lands in the
  // promise callback rather than the effect body, and `alive` drops responses
  // from a superseded run. `loading` is only ever cleared, never re-armed: a
  // refresh of an already-rendered list updates rows in place instead of
  // flashing the spinner back under the user.
  useEffect(() => {
    let alive = true;
    void api
      .services()
      .then((r) => alive && setApps(r.apps))
      .catch(() => {
        /* keep last state */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const act = useCallback(
    async (app: AppInfo, action: "start" | "stop" | "restart") => {
      setBusyId(app.id);
      try {
        await api.serviceAction(app.id, action);
      } catch {
        /* keep UI stable */
      } finally {
        setBusyId(null);
        refresh();
      }
    },
    [refresh],
  );

  return { apps, loading, busyId, act, refresh };
}

const appRunning = (a: AppInfo) =>
  a.members.length > 0 && a.members.every((m) => m.running);

function StatusChip({
  running,
  someOn,
}: {
  running: boolean;
  someOn: boolean;
}) {
  const color = running ? "success" : someOn ? "warning" : "default";
  return (
    <Chip size="sm" variant="soft" color={color}>
      {running ? "running" : someOn ? "partial" : "stopped"}
    </Chip>
  );
}

function AppRow({
  app,
  busy,
  onAction,
  onRefresh,
  onLaunch,
}: {
  app: AppInfo;
  busy: boolean;
  onAction: (a: "start" | "stop" | "restart") => void;
  onRefresh: () => void;
  onLaunch: () => void;
}) {
  const meta = TOOLS[app.id];
  const running = appRunning(app);
  const someOn = app.members.some((m) => m.running);
  const Icon: LucideIcon = meta?.icon ?? Box;
  const isAgent = app.id === "agent";
  // Agent is always on, so its link is live even though the row never reports
  // the Stop/running state the other apps do.
  const canOpen = Boolean(meta?.url) && (running || isAgent);

  return (
    // Mount-only fade/slide. No `layout`: rows never reorder and their height is
    // fixed by the server's unit count, so a layout animation would only add
    // artifacts (full `layout` scale-distorts the card's text and buttons,
    // `layout="position"` briefly overlaps neighbouring rows).
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}>
      <Card className="w-full items-stretch sm:flex-row sm:items-center sm:gap-4">
        <Avatar size="sm" className="hidden sm:flex">
          <Avatar.Fallback>
            <Icon size={18} />
          </Avatar.Fallback>
        </Avatar>

        <Card.Header className="min-w-0 flex-1 gap-0.5">
          <Card.Title className="flex items-center gap-2">
            <Avatar size="sm" className="sm:hidden">
              <Avatar.Fallback>
                <Icon size={18} />
              </Avatar.Fallback>
            </Avatar>
            <span className="truncate">{meta?.name ?? app.name}</span>
            <StatusChip running={running} someOn={someOn} />
          </Card.Title>
          <Card.Description className="truncate text-xs">
            {meta?.description}
          </Card.Description>
        </Card.Header>

        <Separator orientation="vertical" className="hidden lg:block" />

        {/* units collapse on narrow screens: the row keeps name + actions */}
        <Card.Content className="hidden gap-1 lg:flex lg:w-64 lg:shrink-0 lg:grow-0">
          {app.members.map((m) => (
            <div key={m.unit} className="flex min-w-0 items-center gap-2">
              <StatusChip running={m.running} someOn={false} />
              <Typography.Code className="truncate">{m.unit}</Typography.Code>
              <Typography type="body-xs" color="muted" truncate>
                {m.name}
              </Typography>
            </div>
          ))}
        </Card.Content>

        <Card.Footer className="shrink-0 gap-2">
          {/* Agent has no start/stop controls: it is the always-on core, so
              starting it is a no-op and stopping it would take the launcher
              down with it. */}
          {isAgent ? null : running ? (
            <>
              <Button
                size="sm"
                variant="danger"
                isDisabled={busy}
                isPending={busy}
                onPress={() => onAction("stop")}>
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : null}
                    Stop
                  </>
                )}
              </Button>
              {meta?.embed ? (
                <Link
                  to={`/embed/${meta.id}`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                  })}>
                  <Frame size={14} />
                  Launch
                </Link>
              ) : null}
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              isDisabled={busy}
              isPending={busy}
              onPress={onLaunch}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  <Rocket size={14} />
                  Launch
                </>
              )}
            </Button>
          )}
          {/* Only apps that actually serve a web UI get this; Docker has no
              `url`, so it renders nothing rather than a permanently dead
              button. */}
          {meta?.url ? (
            <a
              href={meta.url}
              target="_blank"
              rel="noopener"
              aria-disabled={!canOpen}
              title={canOpen ? undefined : "start the app first"}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: canOpen
                  ? undefined
                  : "pointer-events-none opacity-50",
              })}>
              <ArrowUpRight size={14} />
              Open in New Tab
            </a>
          ) : null}
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={`refresh ${meta?.name ?? app.id}`}
            onPress={onRefresh}>
            <RefreshCw size={14} />
          </Button>
        </Card.Footer>
      </Card>
    </motion.li>
  );
}

export function Dashboard({ user }: { user: string }) {
  const { apps, loading, busyId, act, refresh } = useApps();

  // Launch: start (persists across container restarts), then open the app in
  // the launcher iframe when it has an embeddable web UI.
  const launch = useCallback(
    (app: AppInfo) => {
      void act(app, "start").then(() => {
        const meta = TOOLS[app.id];
        if (meta?.embed) {
          window.location.assign(`/launcher/embed/${meta.id}`);
        }
      });
    },
    [act],
  );

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-[#fafafa]/85 backdrop-blur dark:border-zinc-800 dark:bg-[#101114]/85">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a
            href="/"
            title="Open the Agent (OpenChamber)"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Box size={16} className="text-zinc-500 dark:text-zinc-400" />
            DevBox
          </a>
          <div className="flex items-center gap-3">
            <span className="devbox-label">{user}</span>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="sign out"
              onPress={() =>
                void api.logout().then(() => window.location.reload())
              }>
              <LogOut size={15} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <section>
          <Header className="mb-2 px-0 uppercase tracking-wider">
            applications
          </Header>
          {/* Spinner only while the list is still empty: a refresh of an
              already-rendered list updates the rows in place, so the dashboard
              never flashes back to a spinner under the user. */}
          {loading && apps.length === 0 ? (
            <div className="grid place-items-center py-16">
              <Spinner size="lg" aria-label="loading applications" />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {apps.map((a) => (
                <AppRow
                  key={a.id}
                  app={a}
                  busy={busyId === a.id}
                  onAction={(action) => void act(a, action)}
                  onRefresh={refresh}
                  onLaunch={() => launch(a)}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
