import { useState } from "react";
import { useLocation, useSearchParams, Link } from "react-router";
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  Spinner,
  TextField,
  type FormProps,
} from "@heroui/react";
import { KeyRound } from "lucide-react";
import { api } from "../api";

// Derived from the Form prop rather than spelled out: react-aria still types
// its onSubmit with the deprecated React FormEvent.
type FormSubmitHandler = NonNullable<FormProps["onSubmit"]>;

export function LoginPage() {
  const loc = useLocation() as { state?: { from?: string } };
  const [params] = useSearchParams();
  const [pw, setPw] = useState("");
  // Server-side rejection, surfaced through the form's own error channel so it
  // renders in the same FieldError slot as client-side validation.
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `next` comes from the 401 page and is an absolute path outside /ui (a
  // proxied tool); router state carries in-app paths, which are /ui-relative.
  // Only same-origin paths are accepted, so the query cannot become an open
  // redirect to another host.
  const next = params.get("next");
  const target =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : `/ui${loc.state?.from || "/"}`;

  const submit: FormSubmitHandler = async (e) => {
    e.preventDefault();
    setServerErr(null);
    setBusy(true);
    try {
      await api.login(pw);
      // Full reload: the auth gate caches boot state at mount, so a client-side
      // nav would re-render with the stale unauthenticated gate and bounce back.
      window.location.assign(target);
    } catch (er) {
      const s = (er as { status?: number }).status;
      if (s === 409) {
        window.location.assign("/ui/setup");
      } else {
        setServerErr((er as Error).message || "Invalid credentials");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-screen place-items-center px-4">
      <Form
        onSubmit={submit}
        validationErrors={serverErr ? { password: serverErr } : undefined}
        className="devbox-card w-full max-w-sm p-8"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="devbox-chip p-2">
            <KeyRound size={18} />
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">DevBox</h1>
        <p className="devbox-label mb-6">sign in · linux PAM</p>

        <TextField
          name="password"
          type="password"
          isRequired
          value={pw}
          onChange={setPw}
          className="mb-4 flex w-full flex-col gap-1"
        >
          <Label className="devbox-label">password</Label>
          <Input placeholder="your password" />
          <FieldError className="text-sm text-red-600 dark:text-red-400" />
        </TextField>

        <Button type="submit" variant="primary" isPending={busy} fullWidth>
          {({ isPending }) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : null}
              Sign in
            </>
          )}
        </Button>

        <p className="devbox-muted mt-5 text-xs">
          First visit? <Link to="/setup">Set your password</Link>.
        </p>
      </Form>
    </div>
  );
}
