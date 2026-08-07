import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { HeroUIProvider } from "@heroui/react";
import { api, type BootInfo } from "./api";
import { LoginPage } from "./pages/Login";
import { SetupPage } from "./pages/Setup";
import { Dashboard } from "./pages/Dashboard";
import { Embed } from "./pages/Embed";
import "./index.css";

type Gate = { loading: true } | { loading: false; boot: BootInfo };

function useGate(): Gate {
  const [gate, setGate] = useState<Gate>({ loading: true });
  useEffect(() => {
    api
      .boot()
      .then((boot) => setGate({ loading: false, boot }))
      .catch(() => setGate({ loading: false, boot: { authed: false, needsSetup: false, user: null } }));
  }, []);
  return gate;
}

function RequireAuth({ gate, children }: { gate: Extract<Gate, { loading: false }>; children: React.ReactNode }) {
  const loc = useLocation();
  if (!gate.boot.authed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return <>{children}</>;
}

function App() {
  const gate = useGate();
  if (gate.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="devbox-label">DevBox</div>
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HeroUIProvider>
      <BrowserRouter basename="/ui">
        <App />
      </BrowserRouter>
    </HeroUIProvider>
  </StrictMode>
);