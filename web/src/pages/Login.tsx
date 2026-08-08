import { useState } from "react";
import {
  Button,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  Spinner,
  TextField,
  type FormProps,
} from "@heroui/react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { api } from "../api";

// Derived from the Form prop rather than spelled out: react-aria still types
// its onSubmit with the deprecated React FormEvent.
type FormSubmitHandler = NonNullable<FormProps["onSubmit"]>;

const MIN_LEN = 6;

export function LoginPage({
  needsSetup,
  user,
}: {
  needsSetup: boolean;
  user: string;
}) {
  // needsSetup comes from the boot gate; switching mid-flight keeps the form
  // usable if the backend disagrees (e.g. a session that revived between calls).
  const [setupMode, setSetupMode] = useState(needsSetup);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  // Server-side rejection, surfaced through the form's own error channel so it
  // renders in the same FieldError slot as client-side validation.
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Always the launcher. The 401 page's `next` and the router's `from` are
  // deliberately ignored: a session that expired inside a tool is far more
  // often followed by "what else is running?" than by a silent bounce back
  // into the tool, and the dashboard is the one page guaranteed to render
  // whatever state the box is in.
  const target = "/launcher/";

  const submit: FormSubmitHandler = async (e) => {
    e.preventDefault();
    setServerErr(null);
    setBusy(true);
    try {
      if (setupMode) {
        // setup answers with the session cookie itself; a full reload lets the
        // gate pick it up instead of bouncing on stale boot state.
        await api.setup(pw);
      } else {
        await api.login(pw);
      }
      // Full reload: the auth gate caches boot state at mount, so a client-side
      // nav would re-render with the stale unauthenticated gate and bounce back.
      window.location.assign(target);
    } catch (er) {
      const s = (er as { status?: number }).status;
      if (s === 409) {
        // The backend disagrees with our setup mode: flip the form instead of
        // redirecting to a separate setup page.
        setSetupMode((m) => !m);
        setServerErr(null);
      } else {
        setServerErr((er as Error).message || "Invalid credentials");
      }
    } finally {
      setBusy(false);
    }
  };

  const SetupIcon = setupMode ? ShieldCheck : KeyRound;

  return (
    <div className="grid h-screen place-items-center px-4">
      <Form
        onSubmit={submit}
        validationErrors={serverErr ? { password: serverErr } : undefined}
        className="devbox-card w-full max-w-sm p-8"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="devbox-chip p-2">
            <SetupIcon size={18} />
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          {setupMode ? "Set your password" : "DevBox"}
        </h1>
        <p className="devbox-label mb-6">
          {setupMode ? `first visit setup · account ${user}` : "sign in · linux PAM"}
        </p>

        <TextField
          name="password"
          type="password"
          isRequired
          minLength={setupMode ? MIN_LEN : undefined}
          value={pw}
          onChange={setPw}
          className="mb-4 flex w-full flex-col gap-1"
        >
          <Label className="devbox-label">
            {setupMode ? "new password" : "password"}
          </Label>
          <Input placeholder="your password" />
          {setupMode ? (
            <Description className="devbox-muted text-xs">
              At least {MIN_LEN} characters.
            </Description>
          ) : null}
          <FieldError className="text-sm text-red-600 dark:text-red-400" />
        </TextField>

        {setupMode ? (
          <TextField
            name="confirm"
            type="password"
            isRequired
            value={confirm}
            onChange={setConfirm}
            // Runs on submit and again on each edit once the field is invalid.
            validate={(v) => (v === pw ? null : "Passwords do not match.")}
            className="mb-4 flex w-full flex-col gap-1"
          >
            <Label className="devbox-label">confirm password</Label>
            <Input placeholder="repeat" />
            <FieldError className="text-sm text-red-600 dark:text-red-400" />
          </TextField>
        ) : null}

        <Button type="submit" variant="primary" isPending={busy} fullWidth>
          {({ isPending }) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : null}
              {setupMode ? "Create password" : "Sign in"}
            </>
          )}
        </Button>
      </Form>
    </div>
  );
}
