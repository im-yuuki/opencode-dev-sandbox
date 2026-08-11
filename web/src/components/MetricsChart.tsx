import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MetricsSeries {
  dataKey: string;
  name: string;
  color: string;
}

interface MetricsChartProps {
  data: Array<Record<string, number | null>>;
  series: MetricsSeries[];
  label: string;
  /** Fixed Y domain, e.g. [0, 100] for percentage charts. */
  yDomain?: [number, number];
  formatValue?: (v: number) => string;
  /** Suffix shown for every tooltip value, e.g. "%" or "/s". */
  unit?: string;
  height?: number;
}

function Clock({ value }: { value: number }) {
  const d = new Date(value);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return (
    <time dateTime={new Date(value).toISOString()}>
      {hh}:{mm}:{ss}
    </time>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  unit,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    name: string;
    value: number | null;
    color?: string;
  }>;
  label?: number;
  formatValue: (v: number) => string;
  unit?: string;
}) {
  const values = payload?.filter(
    (point): point is typeof point & { value: number } =>
      typeof point.value === "number" && Number.isFinite(point.value),
  );
  if (!active || !values?.length || label == null) return null;
  return (
    <div className="rounded-lg border border-divider bg-background/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm">
      <div className="mb-1 text-muted">
        <Clock value={label} />
      </div>
      {values.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: p.color ?? "#888" }}
          />
          <span className="text-muted">{p.name}:</span>
          <span className="font-medium tabular-nums">
            {formatValue(p.value)}
            {unit ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Compact, dependency-light time-series chart used inside the metric tiles.
 * Axes are hidden: the current value is shown as text next to the chart and
 * the sparkline carries the shape of the last minute.
 */
export function MetricsChart({
  data,
  series,
  label,
  yDomain,
  formatValue = (v) => v.toFixed(1),
  unit,
  height = 96,
}: MetricsChartProps) {
  // Keep every sparkline on the same sliding one-minute time window. Using
  // dataMin/dataMax makes the plot viewport expand from the first sample to
  // the full window, which makes the line appear to stretch and then shrink
  // as the history fills—especially noticeable for network rates.
  const latestAt = data[data.length - 1]?.at ?? 0;
  const xDomain: [number, number] = [latestAt - 60_000, latestAt];

  return (
    <div
      role="img"
      aria-label={label}
      className="h-full w-full"
      style={{ minHeight: height }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          accessibilityLayer>
          <XAxis dataKey="at" type="number" hide domain={xDomain} />
          <YAxis hide domain={yDomain ?? ["auto", "auto"]} />
          <Tooltip
            cursor={{ stroke: "currentColor", strokeOpacity: 0.2 }}
            content={
              <ChartTooltip formatValue={formatValue} unit={unit} />
            }
          />
          {series.map((s) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
