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
import { ShieldCheck } from "lucide-react";
import { api } from "../api";

// See Login.tsx: react-aria still types onSubmit with the deprecated FormEvent.
type FormSubmitHandler = NonNullable<FormProps["onSubmit"]>;

const MIN_LEN = 6;

export function SetupPage({ user }: { user: string }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  // Backend failure only; length and match are handled by field validation.
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit: FormSubmitHandler = async (e) => {
    e.preventDefault();
    setServerErr(null);
    setBusy(true);
    try {
      await api.setup(pw);
      await api.login(pw);
      // Full reload: the auth gate caches boot state at mount (see Login.tsx).
      window.location.assign("/ui/");
    } catch (er) {
      setServerErr((er as Error).message || "Could not set password.");
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
            <ShieldCheck size={18} />
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Set your password</h1>
        <p className="devbox-label mb-6">first visit setup · account {user}</p>

        <TextField
          name="password"
          type="password"
          isRequired
          minLength={MIN_LEN}
          value={pw}
          onChange={setPw}
          className="mb-4 flex w-full flex-col gap-1"
        >
          <Label className="devbox-label">new password</Label>
          <Input placeholder="your password" />
          <Description className="devbox-muted text-xs">
            At least {MIN_LEN} characters.
          </Description>
          <FieldError className="text-sm text-red-600 dark:text-red-400" />
        </TextField>

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

        <Button type="submit" variant="primary" isPending={busy} fullWidth>
          {({ isPending }) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : null}
              Create password
            </>
          )}
        </Button>
      </Form>
    </div>
  );
}
