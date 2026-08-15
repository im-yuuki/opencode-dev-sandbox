export type ThemeSetting = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "devbox-theme";

export function readThemeSetting(): ThemeSetting {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(setting: ThemeSetting): void {
  const isDark =
    setting === "dark" ||
    (setting === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function saveThemeSetting(setting: ThemeSetting): void {
  try {
    if (setting === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, setting);
    }
  } catch {
    // Theme still applies for this page when storage is unavailable.
  }
  applyTheme(setting);
}
