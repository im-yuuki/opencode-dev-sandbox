import { Link, useParams } from "react-router";
import { Typography, buttonVariants } from "@heroui/react";
import { ArrowLeft, Frame } from "lucide-react";
import { toolById } from "../tools";
import { ErrorPage } from "./Error";

export function Embed() {
  const { tool } = useParams<{ tool: string }>();
  const def = tool ? toolById(tool) : undefined;

  // Unknown id, or a tool that refuses framing: both are dead ends for this route.
  if (!def || !def.embed) {
    return <ErrorPage code={404} />;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-divider bg-background/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            aria-label="back"
            className={buttonVariants({ variant: "ghost", size: "sm", isIconOnly: true })}
          >
            <ArrowLeft size={15} />
          </Link>
          <Frame size={14} className="text-muted" />
          <Typography.Paragraph size="sm" className="font-medium">
            {def.name}
          </Typography.Paragraph>
          <Typography.Code className="hidden sm:inline">{def.url}</Typography.Code>
        </div>
      </header>
      <iframe
        src={def.url}
        title={def.name}
        className="w-full flex-1 border-0 bg-background"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups"
      />
    </div>
  );
}
