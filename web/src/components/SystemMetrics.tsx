import {
  Card,
  Chip,
  Header,
  ProgressBar,
  Skeleton,
  Typography,
} from "@heroui/react";
import {
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  useSystemMetrics,
  type MetricsSample,
  type MetricsStatus,
} from "../hooks/useSystemMetrics";
import { CHART_COLORS } from "./chartColors";
import { MetricsChart } from "./MetricsChart";

const clampPercent = (n: number | null | undefined) =>
  n == null ? null : Math.min(100, Math.max(0, n));

function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

const formatRate = (n: number | null | undefined) =>
  n == null ? "—" : `${formatBytes(n)}/s`;

function clock(ms: number | null): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface TileProps {
  sample: MetricsSample | null;
  history: MetricsSample[];
  status: MetricsStatus;
}

function TileHeader({
  icon: Icon,
  title,
  right,
}: {
  icon: LucideIcon;
  title: string;
  right?: ReactNode;
}) {
  return (
    <Card.Header className="flex items-center justify-between gap-2">
      <Card.Title className="flex items-center gap-1.5">
        <Icon size={14} className="text-muted" aria-hidden />
        <span className="text-xs uppercase tracking-wider text-muted">
          {title}
        </span>
      </Card.Title>
      {right}
    </Card.Header>
  );
}

function PctChip({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <Chip size="sm" variant="soft" color="default">
        collecting…
      </Chip>
    );
  }
  const color = value > 90 ? "danger" : value > 70 ? "warning" : "success";
  return (
    <Chip size="sm" variant="soft" color={color}>
      {Math.round(value)}%
    </Chip>
  );
}

function CpuTile({ sample, history }: TileProps) {
  const pct = clampPercent(sample?.cpuPercent);
  const data = history
    .map((s) => ({ at: s.at, cpu: s.cpuPercent }))
    .filter((d): d is { at: number; cpu: number } => d.cpu != null);
  const cores = sample?.cpuPercent == null ? null : sample;
  return (
    <Card className="h-full">
      <TileHeader
        icon={Cpu}
        title="CPU"
        right={<PctChip value={pct} />}
      />
      <Card.Content className="flex flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {pct != null ? `${Math.round(pct)}%` : "—"}
          </div>
          <Typography.Paragraph className="text-xs text-muted">
            {cores == null
              ? "collecting baseline…"
              : "last minute usage"}
          </Typography.Paragraph>
        </div>
        <MetricsChart
          data={data}
          series={[
            { dataKey: "cpu", name: "CPU", color: CHART_COLORS.primary },
          ]}
          label="CPU usage, last minute"
          yDomain={[0, 100]}
          unit="%"
          height={72}
        />
      </Card.Content>
    </Card>
  );
}

function LoadTile({ sample, history }: TileProps) {
  const load = sample?.load;
  const data = history.map((s) => ({
    at: s.at,
    one: s.load?.one ?? null,
    five: s.load?.five ?? null,
    fifteen: s.load?.fifteen ?? null,
  }));
  return (
    <Card className="h-full">
      <TileHeader
        icon={Gauge}
        title="Load"
        right={
          <Chip size="sm" variant="secondary" color="default">
            {load ? `${load.one.toFixed(1)}` : "—"}
          </Chip>
        }
      />
      <Card.Content className="flex flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {load ? load.one.toFixed(2) : "—"}
          </div>
          <Typography.Paragraph className="text-xs text-muted">
            1-minute load average
          </Typography.Paragraph>
        </div>
        <MetricsChart
          data={data}
          series={[
            {
              dataKey: "one",
              name: "1m",
              color: CHART_COLORS.primary,
            },
            {
              dataKey: "five",
              name: "5m",
              color: CHART_COLORS.warning,
            },
            {
              dataKey: "fifteen",
              name: "15m",
              color: CHART_COLORS.success,
            },
          ]}
          label="Load average, last minute"
          height={44}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {load ? (
            <>
              <Chip size="sm" variant="tertiary">
                1m {load.one.toFixed(2)}
              </Chip>
              <Chip size="sm" variant="tertiary">
                5m {load.five.toFixed(2)}
              </Chip>
              <Chip size="sm" variant="tertiary">
                15m {load.fifteen.toFixed(2)}
              </Chip>
            </>
          ) : (
            <Typography.Paragraph className="text-xs text-muted">
              unavailable
            </Typography.Paragraph>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}

function MemoryTile({ sample, history }: TileProps) {
  const mem = sample?.memory;
  const used = mem?.usedBytes ?? null;
  const limit = mem?.limitBytes ?? null;
  const pct = clampPercent(
    used != null && limit != null && limit > 0 ? (used / limit) * 100 : null,
  );
  const data = history
    .map((s) => {
      const u = s.memory?.usedBytes ?? null;
      const l = s.memory?.limitBytes ?? null;
      return {
        at: s.at,
        memory: u != null && l != null && l > 0 ? (u / l) * 100 : null,
      };
    })
    .filter((d): d is { at: number; memory: number } => d.memory != null);
  return (
    <Card className="h-full">
      <TileHeader
        icon={MemoryStick}
        title="Memory"
        right={<PctChip value={pct} />}
      />
      <Card.Content className="flex flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatBytes(used)}
          </div>
          <Typography.Paragraph className="text-xs text-muted">
            of {formatBytes(limit)} {mem ? `· ${mem.source}` : ""}
          </Typography.Paragraph>
        </div>
        {pct != null ? (
          <ProgressBar value={pct} color={pct > 90 ? "danger" : "accent"}>
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        ) : null}
        <MetricsChart
          data={data}
          series={[
            {
              dataKey: "memory",
              name: "Memory",
              color: CHART_COLORS.primary,
            },
          ]}
          label="Memory usage, last minute"
          yDomain={[0, 100]}
          unit="%"
          height={44}
        />
        <Typography.Paragraph className="text-xs text-muted">
          {formatBytes(mem?.availableBytes ?? null)} available
        </Typography.Paragraph>
      </Card.Content>
    </Card>
  );
}

function DiskTile({ sample }: TileProps) {
  const disk = sample?.disk;
  const total = disk?.totalBytes ?? null;
  const used = disk?.usedBytes ?? null;
  const available = disk?.availableBytes ?? null;
  const pct = clampPercent(
    used != null && total != null && total > 0 ? (used / total) * 100 : null,
  );
  return (
    <Card className="h-full">
      <TileHeader
        icon={HardDrive}
        title={`Storage${disk ? ` · ${disk.path}` : ""}`}
        right={<PctChip value={pct} />}
      />
      <Card.Content className="flex flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatBytes(used)}
          </div>
          <Typography.Paragraph className="text-xs text-muted">
            used of {formatBytes(total)}
          </Typography.Paragraph>
        </div>
        {pct != null ? (
          <ProgressBar value={pct} color="accent">
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        ) : (
          <Typography.Paragraph className="text-xs text-muted">
            unavailable
          </Typography.Paragraph>
        )}
        <Typography.Paragraph className="text-xs text-muted">
          {formatBytes(available)} free
        </Typography.Paragraph>
      </Card.Content>
    </Card>
  );
}

function NetworkTile({ sample, history }: TileProps) {
  const rx = sample?.rxRate ?? null;
  const tx = sample?.txRate ?? null;
  const data = history.map((s) => ({
    at: s.at,
    rx: s.rxRate,
    tx: s.txRate,
  }));
  return (
    <Card className="h-full">
      <TileHeader
        icon={Network}
        title="Network"
        right={
          <div className="flex items-center gap-2 text-xs tabular-nums">
            <span className="flex items-center gap-1 text-muted">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: CHART_COLORS.primary }}
              />
              {formatRate(rx)}
            </span>
            <span className="flex items-center gap-1 text-muted">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: CHART_COLORS.warning }}
              />
              {formatRate(tx)}
            </span>
          </div>
        }
      />
      <Card.Content className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {formatRate(rx)}
            </div>
            <Typography.Paragraph className="text-xs text-muted">
              received /s
            </Typography.Paragraph>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {formatRate(tx)}
            </div>
            <Typography.Paragraph className="text-xs text-muted">
              sent /s
            </Typography.Paragraph>
          </div>
        </div>
        <MetricsChart
          data={data}
          series={[
            { dataKey: "rx", name: "Rx", color: CHART_COLORS.primary },
            { dataKey: "tx", name: "Tx", color: CHART_COLORS.warning },
          ]}
          label="Network receive and transmit, last minute"
          unit="/s"
          formatValue={(v) => formatBytes(v)}
          height={44}
        />
      </Card.Content>
    </Card>
  );
}

function LoadingTiles() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 5 }, (_, i) => (
        <Card key={i} className="h-full">
          <Card.Content className="flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-11 w-full" />
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

export function SystemMetrics() {
  const { sample, history, status, lastUpdated } = useSystemMetrics();

  if (status === "error") {
    return (
      <section>
        <Header className="mb-2 px-0 uppercase tracking-wider">
          system
        </Header>
        <Card>
          <Card.Content>
            <Typography.Paragraph className="text-xs text-muted">
              System metrics are unavailable — the metrics API could not be
              reached.
            </Typography.Paragraph>
          </Card.Content>
        </Card>
      </section>
    );
  }

  if (status === "loading" || sample == null) {
    return (
      <section>
        <Header className="mb-2 px-0 uppercase tracking-wider">
          system
        </Header>
        <LoadingTiles />
      </section>
    );
  }

  const tilesProps: TileProps = { sample, history, status };

  return (
    <section aria-label="System metrics">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Header className="px-0 uppercase tracking-wider">system</Header>
        <div className="flex items-center gap-2">
          {status === "stale" ? (
            <Chip size="sm" variant="soft" color="warning">
              stale
            </Chip>
          ) : null}
          <span className="text-xs text-muted tabular-nums">
            updates every 3s · {clock(lastUpdated ?? 0)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CpuTile {...tilesProps} />
        <LoadTile {...tilesProps} />
        <MemoryTile {...tilesProps} />
        <NetworkTile {...tilesProps} />
        <DiskTile {...tilesProps} />
      </div>
    </section>
  );
}