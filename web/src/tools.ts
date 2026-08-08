import type { LucideIcon } from "lucide-react";
import { Braces, Cable, Container, FolderOpen, MonitorPlay } from "lucide-react";

// Application metadata, keyed by the control plane's app ids. "agent" is the
// always-on core: the dashboard gives it no Stop control, but it does get
// "Open in New Tab" since it is always reachable. `url` is where that link
// goes; apps without one (Docker: no web UI) get no link at all.
// `embed` marks apps safe to render inside the launcher iframe.
export interface ToolDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  url?: string;
  embed?: boolean;
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
    embed: true,
  },
  desktop: {
    id: "desktop",
    name: "Desktop",
    description: "KDE Plasma session via noVNC.",
    icon: MonitorPlay,
    url: "/vnc/vnc.html?path=vnc/websockify&resize=remote&config=devbox-resize-v2",
    embed: true,
  },
  code: {
    id: "code",
    name: "Code",
    description: "Browser code editor (code-server) on /workspace.",
    icon: Braces,
    url: "/code/",
    embed: true,
  },
  docker: {
    id: "docker",
    name: "Docker",
    description: "Nested docker-in-docker daemon.",
    icon: Container,
  },
};

export function toolById(id: string): ToolDef | undefined {
  return TOOLS[id];
}
