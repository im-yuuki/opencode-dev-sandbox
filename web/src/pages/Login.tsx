import { useState } from "react";
import {
  Avatar,
  Button,
  Card,
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
}: {
  needsSetup: boolean;
}) {
  // needsSetup comes from the boot gate; switching mid-flight keeps the form
  // usable if the backend disagrees (e.g. a session that revived between calls).
  const [setupMode, setSetupMode] = useState(needsSetup);
  const [name, setName] = useState("");
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
        await api.login(name, pw);
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
        validationErrors={
          serverErr ? { username: serverErr, password: serverErr } : undefined
        }
        className="w-full max-w-sm">
        <Card className="w-full">
          <Card.Header className="items-start gap-1">
            <Avatar size="lg" className="mb-3">
              <Avatar.Fallback>
                <SetupIcon size={24} />
              </Avatar.Fallback>
            </Avatar>
            <Card.Title className="font-extrabold text-lg">
              {setupMode ? "Set your password" : "Sign in"}
            </Card.Title>
          </Card.Header>

          <Card.Content className="w-full">
            {!setupMode ? (
              <TextField
                name="username"
                isRequired
                value={name}
                onChange={setName}
                className="mb-4 flex w-full flex-col gap-1">
                <Label className="text-xs font-semibold tracking-wider uppercase text-muted">
                  username
                </Label>
                <Input placeholder="your username" autoComplete="username" />
                <FieldError className="text-sm text-danger" />
              </TextField>
            ) : null}

            <TextField
              name="password"
              type="password"
              isRequired
              minLength={setupMode ? MIN_LEN : undefined}
              value={pw}
              onChange={setPw}
              className="mb-4 flex w-full flex-col gap-1">
              <Label className="text-xs font-semibold tracking-wider uppercase text-muted">
                {setupMode ? "new password" : "password"}
              </Label>
              <Input
                placeholder="your unix password"
                autoComplete={setupMode ? "new-password" : "current-password"}
              />
              {setupMode ? (
                <Description className="text-xs text-muted">
                  At least {MIN_LEN} characters.
                </Description>
              ) : null}
              <FieldError className="text-sm text-danger" />
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
                className="flex w-full flex-col gap-1">
                <Label className="text-xs font-semibold tracking-wider uppercase text-muted">
                  confirm password
                </Label>
                <Input placeholder="repeat" autoComplete="new-password" />
                <FieldError className="text-sm text-danger" />
              </TextField>
            ) : null}
          </Card.Content>

          <Card.Footer className="w-full">
            <Button type="submit" variant="primary" isPending={busy} fullWidth>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  {setupMode ? "Create password" : "Sign in"}
                </>
              )}
            </Button>
          </Card.Footer>
        </Card>
      </Form>
    </div>
  );
}
