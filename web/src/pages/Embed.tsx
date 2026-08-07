import { Link, useParams } from "react-router-dom";
import { Button } from "@heroui/react";
import { ArrowLeft, ExternalLink, Frame } from "lucide-react";
import { toolById } from "../tools";

export function Embed() {
  const { tool } = useParams<{ tool: string }>();
  const def = tool ? toolById(tool) : undefined;

  if (!def || !def.embed) {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="devbox-muted mb-4">This tool cannot be embedded.</p>
          <Button as={Link} to="/" variant="bordered" size="sm">
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200/70 bg-white/80 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="flex items-center gap-2">
          <Button as={Link} to="/" isIconOnly size="sm" variant="light" aria-label="back">
            <ArrowLeft size={15} />
          </Button>
          <Frame size={14} className="text-zinc-500 dark:text-zinc-400" />
          <span className="text-sm font-medium">{def.name}</span>
          <span className="devbox-label hidden sm:inline">{def.url}</span>
        </div>
        <Button
          as="a"
          href={def.url}
          target="_blank"
          rel="noopener"
          size="sm"
          variant="bordered"
          startContent={<ExternalLink size={13} />}
        >
          New tab
        </Button>
      </header>
      <iframe
        src={def.url}
        title={def.name}
        className="w-full flex-1 border-0 bg-white dark:bg-zinc-950"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups"
      />
    </div>
  );
}