import type { LucideIcon } from "lucide-react";
import { Braces, Cable, FolderOpen, MonitorPlay, Network, Terminal as TerminalIcon } from "lucide-react";

// Application metadata, keyed by the control plane's app ids. Every app
// starts and stops from the dashboard; `url` is where "Open in New Tab" goes,
// and apps without one get no open link.
export interface ToolDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  url?: string;
}

export const TOOLS: Record<string, ToolDef> = {
  agent: {
    id: "agent",
    name: "Agent",
    description: "OpenCode: sessions, diffs, git, terminal, editor.",
    icon: Cable,
    url: "/",
  },
  files: {
    id: "files",
    name: "Files",
    description: "Manage /workspace files, folders, archives and text.",
    icon: FolderOpen,
    url: "/files/",
  },
  desktop: {
    id: "desktop",
    name: "Desktop",
    description: "LXQt session via noVNC.",
    icon: MonitorPlay,
    url: "/vnc/vnc.html?path=vnc/websockify&resize=remote&config=devbox-resize-v2&autoconnect=1&reconnect=1&reconnect_delay=2000",
  },
  code: {
    id: "code",
    name: "Code",
    description: "Browser code editor (code-server) on /workspace.",
    icon: Braces,
    url: "/code/",
  },
  cliproxy: {
    id: "cliproxy",
    name: "CLI Proxy",
    description: "CLIProxyAPI + Management Center: providers, keys, routing.",
    icon: Network,
    url: "/launcher/mc-boot.html",
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    description: "Persistent tmux terminal sessions with multiple tabs.",
    icon: TerminalIcon,
    url: "/launcher/terminal",
  },
};

export function toolById(id: string): ToolDef | undefined {
  return TOOLS[id];
}
