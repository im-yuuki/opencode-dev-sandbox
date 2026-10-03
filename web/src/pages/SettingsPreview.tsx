import { useEffect } from "react";
import { SettingsDrawer } from "../components/SettingsDrawer";
import { saveThemeSetting } from "../theme";
import type { UserSettings } from "../api";

// Dev-only mock preview for the launcher settings drawer. Intercepts the
// settings API so the real SettingsDrawer renders with fake data, without a
// running control plane. Never linked from production UI (see App routes).
const MOCK: UserSettings = {
  gitUserName: "Ada Lovelace",
  gitUserEmail: "ada@example.com",
  gitDefaultBranch: "main",
  timezone: "Asia/Ho_Chi_Minh",
};

function installMock() {
  const orig = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/launcher/api/v1/settings")) {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return Response.json(MOCK);
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return Response.json({ ...MOCK, ...body });
    }
    return orig(input, init);
  }) as typeof fetch;
}

export function SettingsPreview() {
  useEffect(() => {
    installMock();
    // Deterministic screenshots: optional ?theme=light|dark override and no
    // transitions/animations so the drawer is settled when captured.
    const forced = new URLSearchParams(window.location.search).get("theme");
    if (forced === "light" || forced === "dark") saveThemeSetting(forced);
    const style = document.createElement("style");
    style.textContent =
      "*,*::before,*::after{transition:none!important;animation:none!important}";
    document.head.appendChild(style);
    document.title = "Settings preview | OpenCode DevBox";
    const t = window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="open settings"]')
        ?.click();
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold">
          settings preview (mock, dev only)
        </span>
        <SettingsDrawer />
      </div>
      <p className="mx-auto max-w-5xl px-6 text-sm text-muted">
        The drawer opens automatically with mocked settings data.
      </p>
    </div>
  );
}
