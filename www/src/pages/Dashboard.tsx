import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import {
  LogOut,
  ExternalLink,
  Frame,
  RefreshCw,
  Power,
  Box,
  type LucideIcon,
} from "lucide-react";
import { api, type ServiceInfo } from "../api";
import { TOOLS } from "../tools";

function useServices() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await api.services();
      setServices(r.services);
    } catch {
      /* keep last state */
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (svc: ServiceInfo, action: "start" | "stop" | "restart") => {
      setBusyId(svc.id);
      try {
        await api.serviceAction(svc.id, action);
      } catch {
        /* surface? keep UI stable */
      } finally {
        setBusyId(null);
        void refresh();
      }
    },
    [refresh]
  );

  return { services, busyId, act, refresh };
}

function ServiceCard({
  svc,
  busy,
  onAction,
}: {
  svc: ServiceInfo;
  busy: boolean;
  onAction: (a: "start" | "stop" | "restart") => void;
}) {
  return (
    <div className="devbox-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`dot-toggle ${svc.running ? "bg-emerald-500" : "bg-zinc-300"}`}
              aria-label={svc.running ? "running" : "stopped"}
            />
            <span className="text-sm font-medium">{svc.name}</span>
          </div>
          <div className="devbox-label mt-1">{svc.unit}</div>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          aria-label="refresh status"
          onPress={() => onAction("restart")}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="solid"
          color={svc.running ? "danger" : "primary"}
          isDisabled={busy}
          isLoading={busy}
          onPress={() => onAction(svc.running ? "stop" : "start")}
          className="flex-1"
        >
          {svc.running ? "Stop" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="bordered"
          isDisabled={busy || !svc.running}
          onPress={() => onAction("restart")}
          className="flex-1"
        >
          Restart
        </Button>
      </div>
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
        <span className="rounded-lg bg-zinc-100 p-2 text-zinc-600">
          <Icon size={18} />
        </span>
        <div>
          <div className="text-sm font-medium">{name}</div>
          <div className="devbox-muted text-xs">{description}</div>
        </div>
      </div>
      <div className="mt-auto flex gap-2">
        <Button
          as="a"
          href={`/ui/embed/${id}`}
          size="sm"
          variant="solid"
          color="primary"
          isDisabled={!embed}
          startContent={<Frame size={14} />}
        >
          Embed
        </Button>
        <Button
          as="a"
          href={url}
          target="_blank"
          rel="noopener"
          size="sm"
          variant="bordered"
          startContent={<ExternalLink size={14} />}
        >
          Open
        </Button>
      </div>
    </motion.div>
  );
}

export function Dashboard({ user }: { user: string }) {
  const { services, busyId, act } = useServices();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-[#fafafa]/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Box size={16} className="text-zinc-500" />
            DevBox
          </div>
          <div className="flex items-center gap-3">
            <span className="devbox-label">{user}</span>
            <Button
              isIconOnly
              size="sm"
              variant="light"
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
          <div className="devbox-label mb-3">services · systemd</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <ServiceCard key={s.id} svc={s} busy={busyId === s.id} onAction={(a) => void act(s, a)} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}