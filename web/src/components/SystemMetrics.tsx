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
  Gpu,
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

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}


interface TileProps {
  sample: MetricsSample | null;
  history: MetricsSample[];
  status: MetricsStatus;
}

type ChartState = "ready" | "collecting" | "unavailable";

function hasNumericValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function chartState(
  data: Array<Record<string, number | null>>,
  keys: string[],
  available: boolean,
): ChartState {
  if (!available) return "unavailable";
  const points = data.filter((point) =>
    keys.some((key) => hasNumericValue(point[key])),
  );
  // A single sample has no trend. Keep the graph area stable and show a
  // skeleton until a second usable point arrives, rather than drawing an
  // empty Recharts frame or implying a historical value that does not exist.
  return points.length >= 2 ? "ready" : "collecting";
}

function ChartArea({
  data,
  dataKeys,
  available = true,
  height,
  children,
}: {
  data: Array<Record<string, number | null>>;
  dataKeys: string[];
  available?: boolean;
  height: number;
  children: ReactNode;
}) {
  const state = chartState(data, dataKeys, available);
  if (state === "unavailable") {
    return (
      <div
        className="grid w-full place-items-center rounded-md border border-dashed border-divider text-xs text-muted"
        style={{ height }}
        role="status">
        No data available
      </div>
    );
  }
  if (state === "collecting") {
    return (
      <div style={{ height }} className="relative w-full">
        <Skeleton
          className="h-full w-full rounded-md"
          aria-label="collecting historical chart data"
        />
        <span className="absolute inset-0 grid place-items-center text-xs text-muted">
          Collecting history…
        </span>
      </div>
    );
  }
  return <>{children}</>;
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
  const model = sample?.cpuModel;
  const hostCores = sample?.hostCores;
  const capacityCores = sample?.capacityCores;
  const quotaText =
    capacityCores == null
      ? null
      : Number.isInteger(capacityCores)
        ? String(capacityCores)
        : capacityCores.toFixed(1);
  return (
    <Card className="flex h-full flex-col">
      <TileHeader icon={Cpu} title="CPU" right={<PctChip value={pct} />} />
      <Card.Content className="flex flex-1 flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {pct != null ? `${Math.round(pct)}%` : "—"}
          </div>
          {model ? (
            <p
              title={model}
              className="truncate text-xs text-muted"
              data-testid="cpu-model">
              {model}
            </p>
          ) : (
            <Typography.Paragraph className="text-xs text-muted">
              {pct == null ? "collecting baseline…" : "last minute usage"}
            </Typography.Paragraph>
          )}
        </div>
        <ChartArea data={data} dataKeys={["cpu"]} available={sample?.cpuPercent != null} height={60}>
          <MetricsChart
            data={data}
            series={[
              { dataKey: "cpu", name: "CPU", color: CHART_COLORS.primary },
            ]}
            label="CPU usage, last minute"
            yDomain={[0, 100]}
            unit="%"
            height={60}
          />
        </ChartArea>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {hostCores != null ? (
            <Chip size="sm" variant="tertiary" className="text-muted">
              {hostCores} {hostCores === 1 ? "core" : "cores"}
            </Chip>
          ) : null}
          {quotaText != null ? (
            <Chip size="sm" variant="tertiary" className="text-muted">
              quota {quotaText} {capacityCores === 1 ? "core" : "cores"}
            </Chip>
          ) : null}
        </div>
      </Card.Content>
    </Card>
  );
}

function GpuTile({ sample, history }: TileProps) {
  const gpu = sample?.gpu;
  const util = gpu?.utilizationPercent ?? null;
  const memUsed = gpu?.memoryUsedBytes ?? null;
  const memTotal = gpu?.memoryTotalBytes ?? null;
  const memPct = clampPercent(
    memUsed != null && memTotal != null && memTotal > 0
      ? (memUsed / memTotal) * 100
      : null,
  );
  const data = history.map((s) => {
      const u = s.gpu?.utilizationPercent ?? null;
      const mu = s.gpu?.memoryUsedBytes ?? null;
      const mt = s.gpu?.memoryTotalBytes ?? null;
      return {
        at: s.at,
        util: u,
        memory: mu != null && mt != null && mt > 0 ? (mu / mt) * 100 : null,
      };
    });
  return (
    <Card className="flex h-full flex-col">
      <TileHeader icon={Gpu} title="GPU" right={<PctChip value={util} />} />
      <Card.Content className="flex flex-1 flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {util != null ? `${Math.round(util)}%` : "—"}
          </div>
          {gpu?.name ? (
            <p
              title={gpu.name}
              className="truncate text-xs text-muted"
              data-testid="gpu-model">
              {gpu.name}
            </p>
          ) : (
            <Typography.Paragraph className="text-xs text-muted">
              {gpu ? "GPU accelerator" : "unavailable"}
            </Typography.Paragraph>
          )}
        </div>
        {memPct != null ? (
          <ProgressBar value={memPct} color="accent">
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        ) : null}
        <ChartArea
          data={data}
          dataKeys={["util", "memory"]}
          available={gpu != null}
          height={60}>
          <MetricsChart
            data={data}
            series={[
              {
                dataKey: "util",
                name: "Utilization",
                color: CHART_COLORS.primary,
              },
              {
                dataKey: "memory",
                name: "Memory",
                color: CHART_COLORS.warning,
              },
            ]}
            label="GPU utilization and memory, last minute"
            yDomain={[0, 100]}
            unit="%"
            height={60}
          />
        </ChartArea>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {gpu && gpu.count > 1 ? (
            <Chip size="sm" variant="tertiary" className="text-muted">
              {gpu.count} GPUs
            </Chip>
          ) : null}
          {memUsed != null && memTotal != null ? (
            <Chip size="sm" variant="tertiary" className="text-muted">
              {formatBytes(memUsed)} of {formatBytes(memTotal)}
            </Chip>
          ) : null}
        </div>
      </Card.Content>
    </Card>
  );
}

function LoadTile({ sample, history }: TileProps) {
  const load = sample?.load;
  // Load average is not a percentage by itself. Normalize the 1-minute load
  // against the effective CPU capacity so the chip represents queued work
  // relative to the cores available to this container.
  const loadPct =
    load != null && sample?.capacityCores != null && sample.capacityCores > 0
      ? clampPercent((load.one / sample.capacityCores) * 100)
      : null;
  const data = history.map((s) => ({
    at: s.at,
    one: s.load?.one ?? null,
    five: s.load?.five ?? null,
    fifteen: s.load?.fifteen ?? null,
  }));
  return (
    <Card className="flex h-full flex-col">
      <TileHeader icon={Gauge} title="Load" right={<PctChip value={loadPct} />} />
      <Card.Content className="flex flex-1 flex-col gap-3">
        <div>
          <div className="text-lg font-semibold tabular-nums">
            {load ? `${load.one.toFixed(2)}   ${load.five.toFixed(2)}   ${load.fifteen.toFixed(2)}` : "—- -- --"}
          </div>
          <Typography.Paragraph className="text-xs text-muted">
            {load ? "load average" : "unavailable"}
          </Typography.Paragraph>
        </div>
        <ChartArea
          data={data}
          dataKeys={["one", "five", "fifteen"]}
          available={load != null}
          height={60}>
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
            height={60}
          />
        </ChartArea>
        <Chip size="sm" variant="tertiary" className="mt-auto self-start text-muted">
          uptime {formatDuration(sample?.uptimeSeconds)}
        </Chip>
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
    <Card className="flex h-full flex-col">
      <TileHeader
        icon={MemoryStick}
        title="Memory"
        right={<PctChip value={pct} />}
      />
      <Card.Content className="flex flex-1 flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatBytes(used)}
          </div>
          <Typography.Paragraph className="text-xs text-muted">
            of {formatBytes(limit)}
          </Typography.Paragraph>
        </div>
        {pct != null ? (
          <ProgressBar value={pct} color={pct > 90 ? "danger" : "accent"}>
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        ) : null}
        <div className="mt-auto">
          <ChartArea
            data={data}
            dataKeys={["memory"]}
            available={mem != null}
            height={60}>
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
              height={60}
            />
          </ChartArea>
        </div>
      </Card.Content>
    </Card>
  );
}

function DiskTile({ sample }: TileProps) {
  const disk = sample?.disk;
  const total = disk?.totalBytes ?? null;
  const used = disk?.usedBytes ?? null;
  const pct = clampPercent(
    used != null && total != null && total > 0 ? (used / total) * 100 : null,
  );
  return (
    <Card className="flex h-full flex-col">
      <TileHeader
        icon={HardDrive}
        title="Storage"
        right={<PctChip value={pct} />}
      />
      <Card.Content className="flex flex-1 flex-col gap-3">
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
        <Chip size="sm" variant="tertiary" className="mt-auto self-start text-muted">
          {disk ? disk.path : "unavailable"}
        </Chip>
      </Card.Content>
    </Card>
  );
}

function NetworkTile({ sample, history }: TileProps) {
  const rx = sample?.rxRate ?? null;
  const tx = sample?.txRate ?? null;
  const totalTraffic =
    sample?.rxBytes != null && sample.txBytes != null
      ? sample.rxBytes + sample.txBytes
      : null;
  const data = history.map((s) => ({
    at: s.at,
    rx: s.rxRate,
    tx: s.txRate,
  }));
  return (
    <Card className="flex h-full flex-col">
      <TileHeader icon={Network} title="Network" />
      <Card.Content className="flex flex-1 flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {formatRate(rx)}
            </div>
            <Typography.Paragraph className="text-xs text-muted">
              download
            </Typography.Paragraph>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {formatRate(tx)}
            </div>
            <Typography.Paragraph className="text-xs text-muted">
              upload
            </Typography.Paragraph>
          </div>
        </div>
        <ChartArea
          data={data}
          dataKeys={["rx", "tx"]}
          available={sample?.networkAvailable ?? false}
          height={60}>
          <MetricsChart
            data={data}
            series={[
              { dataKey: "rx", name: "Rx", color: CHART_COLORS.primary },
              { dataKey: "tx", name: "Tx", color: CHART_COLORS.warning },
            ]}
            label="Network receive and transmit, last minute"
            unit="/s"
            formatValue={(v) => formatBytes(v)}
            height={60}
          />
        </ChartArea>
        <Chip size="sm" variant="tertiary" className="mt-auto self-start text-muted">
          total {formatBytes(totalTraffic)}
        </Chip>
      </Card.Content>
    </Card>
  );
}

function LoadingTiles() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i} className="h-full">
          <Card.Header className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-15 w-full rounded-md" />
            <div className="flex gap-1.5">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

export function SystemMetrics() {
  const { sample, history, status } = useSystemMetrics();

  if (status === "error") {
    return (
      <section>
        <Header className="mb-2 px-0 uppercase tracking-wider">system</Header>
        <Card>
          <Card.Content>
            <Typography.Paragraph className="text-xs text-muted">
              System metrics are unavailable — the metrics API could not be reached.
            </Typography.Paragraph>
          </Card.Content>
        </Card>
      </section>
    );
  }

  if (status === "loading" || sample == null) {
    return (
      <section>
        <Header className="mb-2 px-0 uppercase tracking-wider">system</Header>
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
          {status ? (
            <Chip
              size="sm"
              variant="soft"
              color={status === "ready" ? "success" : "warning"}>
              {status}
            </Chip>
          ) : null}
        </div>
      </div>
      <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CpuTile {...tilesProps} />
        {sample.gpu ? <GpuTile {...tilesProps} /> : null}
        <LoadTile {...tilesProps} />
        <MemoryTile {...tilesProps} />
        <NetworkTile {...tilesProps} />
        <DiskTile {...tilesProps} />
      </div>
    </section>
  );
}
