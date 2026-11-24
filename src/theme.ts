export type Theme = "dark" | "light";
const storageKey = "kstruct.theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const color = getComputedStyle(root).getPropertyValue("--surface-app").trim();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", color);
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // A preferência continua ativa nesta janela se o armazenamento falhar.
  }
}
