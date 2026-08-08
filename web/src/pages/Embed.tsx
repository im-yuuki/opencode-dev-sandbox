import { Link, useParams } from "react-router";
import { buttonVariants } from "@heroui/react";
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
          <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200/70 bg-white/80 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            aria-label="back"
            className={buttonVariants({ variant: "ghost", size: "sm", isIconOnly: true })}
          >
            <ArrowLeft size={15} />
          </Link>
          <Frame size={14} className="text-zinc-500 dark:text-zinc-400" />
          <span className="text-sm font-medium">{def.name}</span>
          <span className="devbox-label hidden sm:inline">{def.url}</span>
        </div>
        <a
          href={def.url}
          target="_blank"
          rel="noopener"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink size={13} />
          New tab
        </a>
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