import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Input, Button } from "@heroui/react";
import { KeyRound } from "lucide-react";
import { api } from "../api";

export function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.login(pw);
      nav(loc.state?.from || "/", { replace: true });
    } catch (er) {
      const s = (er as { status?: number }).status;
      if (s === 409) {
        nav("/setup", { replace: true });
      } else {
        setErr((er as Error).message || "Invalid credentials");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <form onSubmit={submit} className="devbox-card w-full max-w-sm p-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-lg bg-zinc-100 p-2 text-zinc-500">
            <KeyRound size={18} />
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">DevBox</h1>
        <p className="devbox-label mb-6">sign in · linux PAM</p>

        <label className="devbox-label" htmlFor="pw">
          password
        </label>
        <Input
          id="pw"
          className="mt-1 mb-4"
          type="password"
          value={pw}
          isRequired
          onChange={(e) => setPw(e.target.value)}
          placeholder="your password"
        />

        {err && (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {err}
          </p>
        )}

        <Button type="submit" color="primary" isLoading={busy} className="w-full" variant="solid">
          Sign in
        </Button>

        <p className="devbox-muted mt-5 text-xs">
          First visit? <Link to="/setup">Set your password</Link>.
        </p>
      </form>
    </div>
  );
}