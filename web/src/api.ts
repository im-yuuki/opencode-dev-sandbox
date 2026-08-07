// Minimal backend client. All requests same-origin -> cookie session.

export interface BootInfo {
  authed: boolean;
  needsSetup: boolean;
  user: string | null;
}

export interface GroupMember {
  unit: string;
  name: string;
  running: boolean;
}

export interface GroupInfo {
  id: string;
  name: string;
  protected: boolean;
  members: GroupMember[];
}

export interface ApiService {
  groups: GroupInfo[];
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
  boot: () => fetch("/api/v1/boot", { credentials: "include" }).then(j<BootInfo>),
  login: (password: string) =>
    fetch("/api/v1/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(j<{ user: string }>),
  setup: (password: string) =>
    fetch("/api/v1/setup", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(j<{ user: string }>),
  logout: () => fetch("/api/v1/logout", { method: "POST", credentials: "include" }).then(j<Record<string, never>>),
  services: () => fetch("/api/v1/services", { credentials: "include" }).then(j<ApiService>),
  serviceAction: (id: string, action: "start" | "stop" | "restart") =>
    fetch(`/api/v1/services/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      credentials: "include",
    }).then(j<{ running: boolean }>),
};