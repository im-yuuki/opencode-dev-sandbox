import type { LucideIcon } from "lucide-react";
import { Cable, MonitorPlay, Terminal } from "lucide-react";

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  url: string;
  embed: boolean; // safe to render inside an iframe
}

export const TOOLS: ToolDef[] = [
  {
    id: "studio",
    name: "OpenChamber",
    description: "OpenCode sessions, diffs, git and the code editor.",
    icon: Cable,
    url: "/",
    embed: false,
  },
  {
    id: "desktop",
    name: "Desktop",
    description: "KDE Plasma session via noVNC.",
    icon: MonitorPlay,
    url: "/vnc/vnc.html?path=vnc/websockify&resize=remote",
    embed: true,
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Dedicated web shell (ttyd) as your user.",
    icon: Terminal,
    url: "/terminal/",
    embed: true,
  },
];

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}