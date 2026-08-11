import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Avatar,
  Button,
  Card,
  Chip,
  Header,
  Link as HeroLink,
  Separator,
  Spinner,
  Typography,
  buttonVariants,
} from "@heroui/react";
import {
  ExternalLink,
  LogOut,
  RefreshCw,
  Box,
  Circle,
  type LucideIcon,
  User,
  Play,
  Square,
} from "lucide-react";
import { api, type AppInfo } from "../api";
import { SystemMetrics } from "../components/SystemMetrics";
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
  const canOpen = Boolean(meta?.url) && running;

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
            <Chip
              size="sm"
              variant="soft"
              color={running ? "success" : someOn ? "warning" : "default"}>
              {running ? "running" : someOn ? "partial" : "stopped"}
            </Chip>
          </Card.Title>
          <Card.Description className="truncate text-xs">
            {meta?.description}
          </Card.Description>
        </Card.Header>

        <Separator orientation="vertical" className="hidden lg:block" />

        {/* units collapse on narrow screens: the row keeps name + actions */}
        <Card.Content className="hidden gap-1 lg:flex lg:w-64 lg:shrink-0 lg:grow-0">
          {app.members.map((m) => (
            <Chip
              key={m.unit}
              size="sm"
              variant="tertiary"
              aria-label={`${m.unit}: ${m.running ? "running" : "stopped"}`}
              color={m.running ? "success" : "default"}
              className="gap-1">
              <Circle aria-hidden size={7} fill="currentColor" />
              <Typography.Code className="truncate text-xs text-muted">
                {m.unit}
              </Typography.Code>
            </Chip>
          ))}
        </Card.Content>

        <Card.Footer className="shrink-0 gap-2">
          {running ? (
            <Button
              size="sm"
              variant="danger"
              isDisabled={busy}
              isPending={busy}
              onPress={() => onAction("stop")}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : <Square size={14} />}
                  Stop
                </>
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              isDisabled={busy}
              isPending={busy}
              onPress={onLaunch}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : <Play size={14} />}
                  Launch
                </>
              )}
            </Button>
          )}
          {/* Only apps that actually serve a web UI get an Open button. */}
          {meta?.url ? (
            <a
              href={meta.url}
              target="_blank"
              rel="noopener"
              aria-disabled={!canOpen}
              aria-label={
                canOpen
                  ? `open ${meta.name} in a new tab`
                  : `${meta.name} is stopped: start it before opening`
              }
              title={
                canOpen
                  ? `Open ${meta.name} in New Tab`
                  : "Please start the app first"
              }
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: canOpen
                  ? undefined
                  : "pointer-events-none opacity-50",
              })}>
              <ExternalLink aria-hidden size={14} />
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
  const build =
    __DEVBOX_BUILD_INFO__.branch !== "unavailable" &&
    __DEVBOX_BUILD_INFO__.commit !== "unavailable" &&
    __DEVBOX_BUILD_INFO__.dirty != null
      ? `${__DEVBOX_BUILD_INFO__.branch}/${__DEVBOX_BUILD_INFO__.commit}${
          __DEVBOX_BUILD_INFO__.dirty ? "-dirty" : ""
        }`
      : "unknown";
  const repository = __DEVBOX_BUILD_INFO__.repository;

  // Launch: start the service (the state persists across container restarts)
  // and refresh the row. Opening the app is left to the user's "Open in New
  // Tab" button: auto-opening trips popup blockers and races the service's
  // own readiness.
  const launch = useCallback((app: AppInfo) => void act(app, "start"), [act]);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-divider bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <HeroLink
            href="/launcher/"
            aria-label="Open the Dashboard"
            className="flex items-center gap-3 text-sm font-semibold tracking-tight text-foreground">
            <Box size={24} className="text-muted" />
            DevBox
          </HeroLink>
          <div className="flex items-center gap-3">
            <Chip size="sm" variant="soft">
              <User size={12} />
              {user}
            </Chip>
            <Button
              isIconOnly
              size="sm"
              variant="danger"
              aria-label="sign out"
              onPress={() =>
                void api.logout().then(() => window.location.reload())
              }>
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <SystemMetrics />

        <section className="mt-10">
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
      <footer className="border-t border-divider px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>build: {build}</span>
          <span aria-hidden>·</span>
          {repository === "unavailable" ? (
            <span>GitHub unavailable</span>
          ) : (
            <a
              href={repository}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline">
              GitHub
            </a>
          )}
          <span aria-hidden>·</span>
          <a
            href="https://hub.docker.com/r/imyuuki/opencode-dev-sandbox"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline">
            Docker Hub
          </a>
        </div>
      </footer>
    </div>
  );
}
