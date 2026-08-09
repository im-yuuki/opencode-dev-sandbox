import { useEffect, useRef, useState } from "react";
import { api, type SystemMetricsResponse } from "../api";

export interface MetricsSample {
  /** Client timestamp (ms) used as the sliding-window X axis. */
  at: number;
  cpuPercent: number | null;
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
}

export type MetricsStatus = "loading" | "ready" | "stale" | "error";

const POLL_MS = 3000;
const WINDOW_MS = 60_000;

interface PrevCounters {
  monotonic: number;
  cpuUsageNs: number | null;
  network: { rxBytes: number; txBytes: number; interfaces: string[] } | null;
}

/**
 * Polls /api/v1/metrics every 3s, derives CPU % and network rates from
 * cumulative deltas, and keeps a one-minute sliding window of samples.
 *
 * - Only one request may be in flight; slow responses are simply skipped.
 * - Timer + request are torn down on unmount (React StrictMode-safe) via an
 *   AbortController and an `alive` flag.
 * - A failed request never wipes the last sample: the dashboard flags the
 *   data as stale instead of flashing errors under the user.
 */
export function useSystemMetrics() {
  const [sample, setSample] = useState<MetricsSample | null>(null);
  const [history, setHistory] = useState<MetricsSample[]>([]);
  const [status, setStatus] = useState<MetricsStatus>("loading");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const prevCounters = useRef<PrevCounters | null>(null);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const controller = new AbortController();

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await api.metrics(controller.signal);
        if (!alive) return;
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

        const next = deriveSample(r, prev, at);
        setSample(next);
        setHistory((old) =>
          [...old, next].filter((p) => at - p.at <= WINDOW_MS).slice(-120),
        );
        setLastUpdated(at);
        setStatus("ready");
      } catch (err) {
        if (
          !alive ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        // Keep the last good sample visible; just signal staleness.
        setStatus((s) =>
          s === "ready" ? "stale" : s === "loading" ? "error" : s,
        );
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
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
    cpuPercent: cpuPct,
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
  };
}