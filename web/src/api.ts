// Minimal backend client. All requests same-origin -> cookie session.

export interface BootInfo {
  authed: boolean;
  needsSetup: boolean;
  user: string | null;
}

export interface AppMember {
  unit: string;
  name: string;
  running: boolean;
}

export interface AppInfo {
  id: string;
  name: string;
  running: boolean;
  members: AppMember[];
}

export interface ApiApps {
  apps: AppInfo[];
}

export interface MetricsCpu {
  /** Cumulative CPU time in nanoseconds; delta-derived % client-side. */
  usageNs: number | null;
  /** Effective capacity in cores (quota, cpuset, or host CPU count). */
  capacityCores: number | null;
  hostCores: number | null;
  /** Human-readable CPU model name, e.g. "Apple M3". */
  model: string | null;
  source: string | null;
}

export interface MetricsLoad {
  one: number;
  five: number;
  fifteen: number;
}

export interface MetricsMemory {
  usedBytes: number;
  limitBytes: number;
  availableBytes: number;
  source: string;
}

export interface MetricsDisk {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  path: string;
}

export interface MetricsNetwork {
  rxBytes: number; // cumulative
  txBytes: number; // cumulative
  interfaces: string[];
}

export interface MetricsGpu {
  count: number;
  name: string | null;
  utilizationPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
}

export interface SystemMetricsResponse {
  monotonic: number;
  uptimeSeconds: number | null;
  cpu: MetricsCpu | null;
  load: MetricsLoad | null;
  memory: MetricsMemory | null;
  disk: MetricsDisk | null;
  network: MetricsNetwork | null;
  gpu: MetricsGpu | null;
}

async function j<T>(res: Response): Promise<T> {
  if (res.status === 204) return {} as T;
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : {};
  if (!res.ok) {
    const err = new Error((body as { error?: string })?.error || `HTTP ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export const api = {
  boot: () => fetch("/launcher/api/v1/boot", { credentials: "include" }).then(j<BootInfo>),
  login: (username: string, password: string) =>
    fetch("/launcher/api/v1/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(j<{ user: string }>),
  setup: (password: string) =>
    fetch("/launcher/api/v1/setup", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(j<{ user: string }>),
  logout: () => fetch("/launcher/api/v1/logout", { method: "POST", credentials: "include" }).then(j<Record<string, never>>),
  services: () => fetch("/launcher/api/v1/services", { credentials: "include" }).then(j<ApiApps>),
  serviceAction: (id: string, action: "start" | "stop" | "restart") =>
    fetch(`/launcher/api/v1/services/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      credentials: "include",
    }).then(j<{ running: boolean }>),
};
