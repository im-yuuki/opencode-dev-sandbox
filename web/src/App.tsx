import { useState, useEffect, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { Spinner } from "@heroui/react";
import { api, type BootInfo } from "./api";
import { LoginPage } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Embed } from "./pages/Embed";
import { ErrorPage } from "./pages/Error";

type Gate =
  | { loading: true }
  | { loading: false; boot: BootInfo }
  | { loading: false; error: number };

function useGate(): Gate {
  const [gate, setGate] = useState<Gate>({ loading: true });
  useEffect(() => {
    let alive = true;
    void api
      .boot()
      .then((boot) => alive && setGate({ loading: false, boot }))
      .catch((er: { status?: number }) => {
        // /boot never rejects for "not signed in" — it answers authed:false.
        // A failure here means the control plane is unreachable, which is worth
        // showing as such instead of a login form that cannot work.
        if (alive) setGate({ loading: false, error: er.status ?? 503 });
      });
    return () => {
      alive = false;
    };
  }, []);
  return gate;
}

function RequireAuth({
  gate,
  children,
}: {
  gate: { boot: BootInfo };
  children: ReactNode;
}) {
  if (!gate.boot.authed) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const gate = useGate();
  const onErrorRoute = useLocation().pathname === "/error";

  // /error is the one route that must render without a working control plane:
  // nginx sends users here precisely when something upstream is broken, and the
  // gate's own boot call is often the thing that failed.
  if (onErrorRoute) {
    return <ErrorPage />;
  }
  if (gate.loading) {
    return (
      <div className="grid h-screen place-items-center gap-3">
        <Spinner size="lg" />
      </div>
    );
  }
  if ("error" in gate) {
    return <ErrorPage code={gate.error} />;
  }

  return (
    <Routes>
      {/* First visit has no password yet: /login renders the setup form
          inline instead of bouncing to a separate page. An already-signed-in
          visitor has nothing to do here and goes to the dashboard, same as a
          fresh sign-in. */}
      <Route
        path="/login"
        element={
          gate.boot.authed ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage needsSetup={gate.boot.needsSetup} />
          )
        }
      />
      {/* kept so pre-remap /setup bookmarks land somewhere sane */}
      <Route path="/setup" element={<Navigate to="/login" replace />} />
      <Route
        path="/"
        element={
          <RequireAuth gate={gate}>
            <Dashboard user={gate.boot.user ?? "user"} />
          </RequireAuth>
        }
      />
      <Route
        path="/embed/:tool"
        element={
          <RequireAuth gate={gate}>
            <Embed />
          </RequireAuth>
        }
      />
      {/* handled above, before the gate: kept so the path is not a 404 */}
      <Route path="/error" element={<ErrorPage />} />
      {/* an unknown SPA path is a genuine 404, not a silent bounce home */}
      <Route path="*" element={<ErrorPage code={404} />} />
    </Routes>
  );
}
