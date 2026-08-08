import { Link, useSearchParams } from "react-router";
import { Button, buttonVariants } from "@heroui/react";
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
    detail: "A service failed while handling the request. Check its logs in Cockpit.",
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

// nginx appends `from=$request_uri` unencoded (it has no urlencode function),
// so a tool URL carrying its own query string — /vnc/vnc.html?path=…&resize=…
// — would be truncated at the first `&` by normal param parsing. `from` is
// always the last parameter, so everything after it is the address verbatim.
// Only same-origin paths are returned, which rules out an open redirect.
function readFrom(search: string): string | null {
  const m = /[?&]from=(.*)$/s.exec(search);
  if (!m) return null;
  const path = m[1];
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}

// Rendered both as a route (/error?code=NNN, where nginx redirects gateway
// failures) and directly with a `code` prop for in-app dead ends.
export function ErrorPage({ code: fixed }: { code?: number } = {}) {
  const [params] = useSearchParams();
  const code = fixed ?? normalize(params.get("code"), 500);
  const { title, detail, icon: Icon } = classify(code);
  // nginx bounces here from the proxied tools (/vnc/, /terminal/, …), which are
  // outside the SPA's basename, so a plain <Link> could not send the user back.
  // `from` carries that address to the login form, which does a full navigation.
  const from = readFrom(window.location.search);

  return (
    <div className="grid h-screen place-items-center px-4">
      <div className="devbox-card w-full max-w-sm p-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="devbox-chip p-2">
            <Icon size={18} />
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="devbox-label mb-4">error {code}</p>
        <p className="devbox-muted mb-6 text-sm">{detail}</p>

        <div className="flex flex-col gap-2">
          {code === 401 ? (
            <Link
              to={from ? `/login?next=${encodeURIComponent(from)}` : "/login"}
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
        </div>
      </div>
    </div>
  );
}
