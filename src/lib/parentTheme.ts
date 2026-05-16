export type ParentTheme = "light" | "dark";

const STORAGE_KEY = "daechi.parentTheme";

export function readParentTheme(): ParentTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeParentTheme(theme: ParentTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
}

export function applyParentThemeClass(theme: ParentTheme, parentSessionActive: boolean) {
  const root = document.documentElement;
  if (!parentSessionActive) {
    root.classList.remove("parent-dark");
    return;
  }
  root.classList.toggle("parent-dark", theme === "dark");
}
