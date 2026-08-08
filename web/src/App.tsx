import { useState, useEffect, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { Spinner } from "@heroui/react";
import { api, type BootInfo } from "./api";
import { LoginPage } from "./pages/Login";
import { SetupPage } from "./pages/Setup";
import { Dashboard } from "./pages/Dashboard";
import { Embed } from "./pages/Embed";

type Gate = { loading: true } | { loading: false; boot: BootInfo };

function useGate(): Gate {
  const [gate, setGate] = useState<Gate>({ loading: true });
  useEffect(() => {
    let alive = true;
    void api
      .boot()
      .then((boot) => alive && setGate({ loading: false, boot }))
      .catch(
        () =>
          alive &&
          setGate({ loading: false, boot: { authed: false, needsSetup: false, user: null } })
      );
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
  gate: Extract<Gate, { loading: false }>;
  children: ReactNode;
}) {
  const loc = useLocation();
  if (!gate.boot.authed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return <>{children}</>;
}

export function App() {
  const gate = useGate();
  if (gate.loading) {
    return (
      <div className="grid h-screen place-items-center gap-3">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/setup"
        element={
          gate.boot.needsSetup ? (
            <SetupPage user={gate.boot.user ?? "user"} />
          ) : (
            <Navigate to={gate.boot.authed ? "/" : "/login"} replace />
          )
        }
      />
      <Route
        path="/login"
        element={gate.boot.authed ? <Navigate to="/" replace /> : <LoginPage />}
      />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
