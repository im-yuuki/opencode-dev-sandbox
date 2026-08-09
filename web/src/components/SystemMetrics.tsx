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


interface TileProps {
  sample: MetricsSample | null;
  history: MetricsSample[];
  status: MetricsStatus;
}

/** Shows a shimmer placeholder until a series has at least two points — a lone
 *  sample cannot draw a line, so it reads as "still collecting" instead of an
 *  empty plot. */
function ChartArea({
  ready,
  height,
  children,
}: {
  ready: boolean;
  height: number;
  children: ReactNode;
}) {
  if (!ready) {
    return (
      <div style={{ height }} className="w-full">
        <Skeleton
          className="h-full w-full rounded-md"
          aria-label="collecting chart data"
        />
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
    <Card className="h-full">
      <TileHeader icon={Cpu} title="CPU" right={<PctChip value={pct} />} />
      <Card.Content className="flex flex-col gap-3">
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
        <ChartArea ready={data.length >= 2} height={72}>
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
        </ChartArea>
        <div className="flex flex-wrap items-center gap-1.5">
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
  const data = history
    .map((s) => {
      const u = s.gpu?.utilizationPercent ?? null;
      const mu = s.gpu?.memoryUsedBytes ?? null;
      const mt = s.gpu?.memoryTotalBytes ?? null;
      return {
        at: s.at,
        util: u,
        memory: mu != null && mt != null && mt > 0 ? (mu / mt) * 100 : null,
      };
    })
    .filter(
      (d): d is { at: number; util: number; memory: number } => d.util != null,
    );
  return (
    <Card className="h-full">
      <TileHeader icon={Gpu} title="GPU" right={<PctChip value={util} />} />
      <Card.Content className="flex flex-col gap-3">
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
        <ChartArea ready={data.length >= 2} height={44}>
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
            height={44}
          />
        </ChartArea>
        <div className="flex flex-wrap items-center gap-1.5">
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
  const data = history.map((s) => ({
    at: s.at,
    one: s.load?.one ?? null,
    five: s.load?.five ?? null,
    fifteen: s.load?.fifteen ?? null,
  }));
  return (
    <Card className="h-full">
      <TileHeader icon={Gauge} title="Load" />
      <Card.Content className="flex flex-col gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {load ? load.one.toFixed(2) : "—"}
          </div>
          <Typography.Paragraph className="text-xs text-muted">
            1-minute load average
          </Typography.Paragraph>
        </div>
        <ChartArea ready={data.length >= 2} height={44}>
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
        </ChartArea>
        <div className="flex flex-wrap items-center gap-1.5">
          {load ? (
            <>
              <Chip size="sm" variant="tertiary" className="text-muted">
                5m {load.five.toFixed(2)}
              </Chip>
              <Chip size="sm" variant="tertiary" className="text-muted">
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
        <ChartArea ready={data.length >= 2} height={44}>
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
        </ChartArea>
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
    <Card className="h-full">
      <TileHeader
        icon={HardDrive}
        title="Storage"
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
          {disk ? disk.path : "unavailable"}
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
      <TileHeader icon={Network} title="Network" />
      <Card.Content className="flex flex-col gap-3">
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
        <ChartArea ready={data.length >= 2} height={44}>
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
        </ChartArea>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
