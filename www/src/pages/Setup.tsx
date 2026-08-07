import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Input, Button } from "@heroui/react";
import { ShieldCheck } from "lucide-react";
import { api } from "../api";

export function SetupPage({ user }: { user: string }) {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (pw !== confirm) {
      setErr("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.setup(pw);
      await api.login(pw);
      nav("/", { replace: true });
    } catch (er) {
      setErr((er as Error).message || "Could not set password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <form onSubmit={submit} className="devbox-card w-full max-w-sm p-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-lg bg-zinc-100 p-2 text-zinc-500">
            <ShieldCheck size={18} />
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Set your password</h1>
        <p className="devbox-label mb-6">first visit setup · account {user}</p>

        <label className="devbox-label" htmlFor="npw">
          new password
        </label>
        <Input
          id="npw"
          className="mt-1 mb-4"
          type="password"
          value={pw}
          isRequired
          onChange={(e) => setPw(e.target.value)}
          placeholder="min. 6 characters"
        />

        <label className="devbox-label" htmlFor="cpw">
          confirm password
        </label>
        <Input
          id="cpw"
          className="mt-1 mb-4"
          type="password"
          value={confirm}
          isRequired
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="repeat"
        />

        {err && (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {err}
          </p>
        )}

        <Button type="submit" color="primary" isLoading={busy} className="w-full">
          Create password
        </Button>
      </form>
    </div>
  );
}