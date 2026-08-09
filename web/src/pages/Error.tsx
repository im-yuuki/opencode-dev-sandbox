import { Link, useSearchParams } from "react-router";
import { Avatar, Button, Card, Typography, buttonVariants } from "@heroui/react";
import {
  Lock,
  LogIn,
  RefreshCw,
  SearchX,
  ServerCrash,
  ShieldOff,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

interface ErrorDef {
  title: string;
  detail: string;
  icon: LucideIcon;
}

const ERRORS: Record<number, ErrorDef> = {
  400: {
    title: "Bad request",
    detail: "The gateway could not make sense of that request.",
    icon: TriangleAlert,
  },
  401: {
    title: "Session expired",
    detail: "This page needs a signed-in DevBox session.",
    icon: Lock,
  },
  403: {
    title: "Forbidden",
    detail:
      "That action is not allowed. Protected units such as the gateway and control plane cannot be stopped.",
    icon: ShieldOff,
  },
  404: {
    title: "Not found",
    detail: "Nothing is served at this address.",
    icon: SearchX,
  },
  413: {
    title: "Payload too large",
    detail: "The upstream service refused a request of that size.",
    icon: TriangleAlert,
  },
  500: {
    title: "Server error",
    detail: "A service failed while handling the request. Check the container logs.",
    icon: ServerCrash,
  },
  502: {
    title: "Service not responding",
    detail: "The upstream service is down or still starting. Check its state on the dashboard.",
    icon: ServerCrash,
  },
  503: {
    title: "Service unavailable",
    detail: "The service is stopped. Start it from the dashboard, then retry.",
    icon: ServerCrash,
  },
  504: {
    title: "Upstream timed out",
    detail: "The service took too long to answer. It may be busy or wedged.",
    icon: ServerCrash,
  },
};

function classify(code: number): ErrorDef {
  const known = ERRORS[code];
  if (known) return known;
  if (code >= 500)
    return { title: "Server error", detail: "Something broke inside the box.", icon: ServerCrash };
  return {
    title: "Request rejected",
    detail: "The gateway refused this request.",
    icon: TriangleAlert,
  };
}

function normalize(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : fallback;
}

// Rendered both as a route (/error?code=NNN, where nginx redirects gateway
// failures) and directly with a `code` prop for in-app dead ends.
export function ErrorPage({ code: fixed }: { code?: number } = {}) {
  const [params] = useSearchParams();
  const code = fixed ?? normalize(params.get("code"), 500);
  const { title, detail, icon: Icon } = classify(code);

  return (
    <div className="grid h-screen place-items-center px-4">
      <Card className="w-full max-w-sm">
        <Card.Header className="items-start gap-1">
          <Avatar size="md" className="mb-1">
            <Avatar.Fallback>
              <Icon size={24} />
            </Avatar.Fallback>
          </Avatar>
          <Card.Title className="text-xl tracking-tight">{title}</Card.Title>
        </Card.Header>

        <Card.Content>
          <Typography.Paragraph color="muted" size="sm">
            {code}: {detail}
          </Typography.Paragraph>
        </Card.Content>

        <Card.Footer className="flex-col gap-2">
          {code === 401 ? (
            <Link
              to="/login"
              className={buttonVariants({ variant: "primary", fullWidth: true })}
            >
              <LogIn size={15} />
              Go to login
            </Link>
          ) : (
            <Link
              to="/"
              className={buttonVariants({ variant: "primary", fullWidth: true })}
            >
              Back to dashboard
            </Link>
          )}
          <Button variant="outline" fullWidth onPress={() => window.location.reload()}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </Card.Footer>
      </Card>
    </div>
  );
}
