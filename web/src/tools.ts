import type { LucideIcon } from "lucide-react";
import { Braces, Cable, FolderOpen, MonitorPlay, Network } from "lucide-react";

// Application metadata, keyed by the control plane's app ids. "agent" is the
// always-on core: the dashboard gives it no Stop control, but it does get
// "Open in New Tab" since it is always reachable. `url` is where that link
// goes; apps without one get no link at all.
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
    url: "/vnc/vnc.html?path=vnc/websockify&resize=remote&config=devbox-resize-v2",
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
    url: "/management.html",
  },
};

export function toolById(id: string): ToolDef | undefined {
  return TOOLS[id];
}
