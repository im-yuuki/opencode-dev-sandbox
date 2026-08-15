import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Description,
  Drawer,
  FieldError,
  Form,
  Input,
  Label,
  Separator,
  Spinner,
  TextField,
} from "@heroui/react";
import { Check, GitBranch, KeyRound, Palette, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, type UserSettings } from "../api";
import {
  applyTheme,
  readThemeSetting,
  saveThemeSetting,
  type ThemeSetting,
} from "../theme";

const TIMEZONES = [
  "UTC",
  "Asia/Ho_Chi_Minh",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "America/Los_Angeles",
  "America/New_York",
];

const emptyDraft: UserSettings = {
  gitUserName: "",
  gitUserEmail: "",
  gitDefaultBranch: "main",
  timezone: "UTC",
};

function SettingHeading({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <Icon size={16} className="text-muted" />
      {children}
    </div>
  );
}

export function SettingsDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<UserSettings>(emptyDraft);
  const [timezoneOptions, setTimezoneOptions] = useState(TIMEZONES);
  const [theme, setTheme] = useState<ThemeSetting>(() => readThemeSetting());
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    void api
      .settings()
      .then((next) => {
        if (!alive) return;
        setDraft({
          gitUserName: next.gitUserName ?? "",
          gitUserEmail: next.gitUserEmail ?? "",
          gitDefaultBranch: next.gitDefaultBranch ?? "main",
          timezone: next.timezone,
        });
        setTimezoneOptions((current) =>
          current.includes(next.timezone) ? current : [next.timezone, ...current],
        );
      })
      .catch((error: Error) => alive && setSettingsError(error.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [isOpen]);

  const openSettings = () => {
    setLoading(true);
    setSettingsError(null);
    setSettingsNotice(null);
    setIsOpen(true);
  };

  const updateDraft = (key: keyof UserSettings, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSettingsNotice(null);
    setSettingsError(null);
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSettingsError(null);
    setSettingsNotice(null);
    try {
      const saved = await api.updateSettings(draft);
      setDraft(saved);
      setSettingsNotice("Settings saved.");
    } catch (error) {
      setSettingsError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("Password changed. Your current session remains active.");
    } catch (error) {
      setPasswordError((error as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <Drawer>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label="open settings"
        onPress={openSettings}>
        <Settings2 size={16} />
      </Button>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={setIsOpen} variant="blur">
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-full sm:max-w-md">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>Launcher settings</Drawer.Heading>
              <Description className="text-sm text-muted">
                Quick settings for this DevBox environment.
              </Description>
            </Drawer.Header>
            <Drawer.Body className="gap-6">
              {loading ? (
                <div className="grid place-items-center py-12">
                  <Spinner aria-label="Loading settings" />
                </div>
              ) : (
                <>
                  <Form className="flex flex-col gap-4" onSubmit={saveSettings}>
                    <SettingHeading icon={GitBranch}>Git identity</SettingHeading>
                    <TextField
                      name="gitUserName"
                      value={draft.gitUserName ?? ""}
                      onChange={(value) => updateDraft("gitUserName", value)}
                      className="flex flex-col gap-1">
                      <Label>Name</Label>
                      <Input variant="secondary" placeholder="Your name" />
                    </TextField>
                    <TextField
                      name="gitUserEmail"
                      type="email"
                      value={draft.gitUserEmail ?? ""}
                      onChange={(value) => updateDraft("gitUserEmail", value)}
                      className="flex flex-col gap-1">
                      <Label>Email</Label>
                      <Input variant="secondary" placeholder="you@example.com" />
                    </TextField>
                    <TextField
                      name="gitDefaultBranch"
                      value={draft.gitDefaultBranch ?? "main"}
                      onChange={(value) => updateDraft("gitDefaultBranch", value)}
                      className="flex flex-col gap-1">
                      <Label>Default branch</Label>
                      <Input variant="secondary" placeholder="main" />
                      <Description>Used by `git init` for new repositories.</Description>
                    </TextField>

                    <Separator />
                    <div className="flex flex-col gap-3">
                      <SettingHeading icon={Settings2}>Environment</SettingHeading>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="timezone">Timezone</Label>
                        <select
                          id="timezone"
                          value={draft.timezone}
                          onChange={(event) => updateDraft("timezone", event.target.value)}
                          className="min-h-10 rounded-field border border-field-border bg-field px-3 text-sm text-field-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus">
                          {timezoneOptions.map((timezone) => (
                            <option key={timezone} value={timezone}>
                              {timezone === "UTC" ? "UTC (recommended)" : timezone}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <Button type="submit" variant="primary" isPending={saving}>
                      {({ isPending }) => (
                        <>
                          {isPending ? <Spinner color="current" size="sm" /> : <Check size={15} />}
                          Save settings
                        </>
                      )}
                    </Button>
                    {settingsError ? <FieldError>{settingsError}</FieldError> : null}
                    {settingsNotice ? (
                      <p className="text-sm text-success" role="status">
                        {settingsNotice}
                      </p>
                    ) : null}
                  </Form>

                  <Separator />
                  <div className="flex flex-col gap-3">
                    <SettingHeading icon={Palette}>Appearance</SettingHeading>
                    <Description className="text-sm text-muted">
                      This preference stays in this browser and is not sent to the server.
                    </Description>
                    <div className="grid grid-cols-3 gap-2">
                      {(["system", "light", "dark"] as const).map((option) => (
                        <Button
                          key={option}
                          type="button"
                          size="sm"
                          variant={theme === option ? "primary" : "outline"}
                          aria-label={`Use ${option} theme`}
                          onPress={() => {
                            setTheme(option);
                            saveThemeSetting(option);
                          }}>
                          {option === "system" ? "System" : option[0].toUpperCase() + option.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <Separator />
                  <Form className="flex flex-col gap-4" onSubmit={changePassword}>
                    <SettingHeading icon={KeyRound}>Change password</SettingHeading>
                    <Description className="text-sm text-muted">
                      This is also the Unix and launcher login password.
                    </Description>
                    <TextField
                      name="currentPassword"
                      type="password"
                      isRequired
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      className="flex flex-col gap-1">
                      <Label>Current password</Label>
                      <Input variant="secondary" autoComplete="current-password" />
                    </TextField>
                    <TextField
                      name="newPassword"
                      type="password"
                      isRequired
                      minLength={6}
                      value={newPassword}
                      onChange={setNewPassword}
                      className="flex flex-col gap-1">
                      <Label>New password</Label>
                      <Input variant="secondary" autoComplete="new-password" />
                    </TextField>
                    <TextField
                      name="confirmPassword"
                      type="password"
                      isRequired
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      className="flex flex-col gap-1">
                      <Label>Confirm new password</Label>
                      <Input variant="secondary" autoComplete="new-password" />
                    </TextField>
                    <Button type="submit" variant="outline" isPending={passwordBusy}>
                      {({ isPending }) => (
                        <>
                          {isPending ? <Spinner color="current" size="sm" /> : <KeyRound size={15} />}
                          Update password
                        </>
                      )}
                    </Button>
                    {passwordError ? <FieldError>{passwordError}</FieldError> : null}
                    {passwordNotice ? (
                      <p className="text-sm text-success" role="status">
                        {passwordNotice}
                      </p>
                    ) : null}
                  </Form>
                </>
              )}
            </Drawer.Body>
            <Drawer.Footer>
              <Button slot="close" variant="secondary" fullWidth>
                Close
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
