import { useEffect, useRef, useState } from "react";
import type { SystemMetricsResponse } from "../api";

export interface MetricsSample {
  /** Client timestamp (ms) used as the sliding-window X axis. */
  at: number;
  /** Seconds since the container's PID 1 started. */
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  /** Human-readable CPU model name (static per boot). */
  cpuModel: string | null;
  /** Physical cores reported by the host. */
  hostCores: number | null;
  /** Effective cores the cgroup can use (quota/cpuset). */
  capacityCores: number | null;
  /** GPU summary; null when the box has no GPU. */
  gpu: {
    count: number;
    name: string | null;
    utilizationPercent: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
  } | null;
  load: { one: number; five: number; fifteen: number } | null;
  memory: {
    usedBytes: number;
    limitBytes: number;
    availableBytes: number;
    source: string;
  } | null;
  disk: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    path: string;
  } | null;
  /**
   * Network rates derived from cumulative counters. Null until a second
   * snapshot exists (or when the backend counter reset, which produces a
   * negative delta we refuse to render).
   */
  rxRate: number | null; // bytes / s
  txRate: number | null;
  /** Cumulative non-loopback traffic observed by the container. */
  rxBytes: number | null;
  txBytes: number | null;
  /** Whether the backend exposed at least one non-loopback interface. */
  networkAvailable: boolean;
}

export type MetricsStatus = "loading" | "ready" | "stale" | "error";

const WINDOW_MS = 60_000;
const STREAM_URL = "/launcher/api/v1/metrics/stream";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

interface PrevCounters {
  monotonic: number;
  cpuUsageNs: number | null;
  network: { rxBytes: number; txBytes: number; interfaces: string[] } | null;
}

/**
 * Receives a metrics snapshot every second over SSE, derives CPU % and network
 * rates from cumulative deltas, and keeps a one-minute sliding window.
 *
 * - Disconnects use bounded exponential backoff and reconnect automatically.
 * - The EventSource and retry timer are torn down on unmount (StrictMode-safe).
 * - A disconnect never wipes the last sample: the dashboard marks it stale.
 */
export function useSystemMetrics() {
  const [sample, setSample] = useState<MetricsSample | null>(null);
  const [history, setHistory] = useState<MetricsSample[]>([]);
  const [status, setStatus] = useState<MetricsStatus>("loading");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const prevCounters = useRef<PrevCounters | null>(null);

  useEffect(() => {
    let alive = true;
    let hasSample = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let source: EventSource | null = null;

    function scheduleReconnect() {
      if (!alive || reconnectTimer != null) return;
      const exponential = Math.min(
        RECONNECT_BASE_MS * 2 ** reconnectAttempt,
        RECONNECT_MAX_MS,
      );
      const delay = exponential + Math.floor(Math.random() * 250);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (!alive || source) return;
      const connection = new EventSource(STREAM_URL, { withCredentials: true });
      source = connection;

      connection.addEventListener("metrics", (event) => {
        if (!alive || source !== connection) return;
        try {
          const r = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as SystemMetricsResponse;
          const at = Date.now();

          const prev = prevCounters.current;
          prevCounters.current = {
            monotonic: r.monotonic,
            cpuUsageNs: r.cpu?.usageNs ?? null,
            network: r.network
              ? {
                  rxBytes: r.network.rxBytes,
                  txBytes: r.network.txBytes,
                  interfaces: r.network.interfaces,
                }
              : null,
          };

          const nextSample = deriveSample(r, prev, at);
          setSample(nextSample);
          setHistory((old) =>
            [...old, nextSample]
              .filter((p) => at - p.at <= WINDOW_MS)
              .slice(-120),
          );
          setLastUpdated(at);
          setStatus("ready");
          hasSample = true;
          reconnectAttempt = 0;
        } catch {
          // Keep the first render in its loading state while the stream is
          // warming up. Showing an error card here makes a transient malformed
          // event look like a permanent metrics failure.
          setStatus(hasSample ? "stale" : "loading");
        }
      });

      connection.onerror = () => {
        if (!alive || source !== connection) return;
        connection.close();
        source = null;
        setStatus(hasSample ? "stale" : "loading");
        scheduleReconnect();
      };
    }

    connect();
    return () => {
      alive = false;
      source?.close();
      source = null;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    };
  }, []);

  return { sample, history, status, lastUpdated };
}

function deriveSample(
  cur: SystemMetricsResponse,
  prev: PrevCounters | null,
  at: number,
): MetricsSample {
  let cpuPct: number | null = null;
  if (cur.cpu && prev) {
    const dTime = cur.monotonic - prev.monotonic;
    const dUsage =
      cur.cpu.usageNs != null && prev.cpuUsageNs != null
        ? cur.cpu.usageNs - prev.cpuUsageNs
        : null;
    if (
      dTime > 0 &&
      dUsage != null &&
      dUsage >= 0 &&
      cur.cpu.capacityCores != null &&
      cur.cpu.capacityCores > 0
    ) {
      cpuPct = (dUsage / 1e9 / (dTime * cur.cpu.capacityCores)) * 100;
    }
  }

  let rxRate: number | null = null;
  let txRate: number | null = null;
  const net = cur.network;
  if (net && prev?.network) {
    const dTime = cur.monotonic - prev.monotonic;
    if (dTime > 0) {
      const drx = net.rxBytes - prev.network.rxBytes;
      const dtx = net.txBytes - prev.network.txBytes;
      if (drx >= 0) rxRate = drx / dTime;
      if (dtx >= 0) txRate = dtx / dTime;
    }
  }

  return {
    at,
    uptimeSeconds: cur.uptimeSeconds ?? null,
    cpuPercent: cpuPct,
    cpuModel: cur.cpu?.model ?? null,
    hostCores: cur.cpu?.hostCores ?? null,
    capacityCores: cur.cpu?.capacityCores ?? null,
    gpu: cur.gpu
      ? {
          count: cur.gpu.count,
          name: cur.gpu.name,
          utilizationPercent: cur.gpu.utilizationPercent,
          memoryUsedBytes: cur.gpu.memoryUsedBytes,
          memoryTotalBytes: cur.gpu.memoryTotalBytes,
        }
      : null,
    load: cur.load
      ? {
          one: cur.load.one,
          five: cur.load.five,
          fifteen: cur.load.fifteen,
        }
      : null,
    memory: cur.memory
      ? {
          usedBytes: cur.memory.usedBytes,
          limitBytes: cur.memory.limitBytes,
          availableBytes: cur.memory.availableBytes,
          source: cur.memory.source,
        }
      : null,
    disk: cur.disk
      ? {
          totalBytes: cur.disk.totalBytes,
          usedBytes: cur.disk.usedBytes,
          availableBytes: cur.disk.availableBytes,
          path: cur.disk.path,
        }
      : null,
    rxRate,
    txRate,
    rxBytes: net?.rxBytes ?? null,
    txBytes: net?.txBytes ?? null,
    networkAvailable: cur.network != null,
  };
}
