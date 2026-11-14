export type Theme = "light" | "dark";

const STORAGE_KEY = "paikan-theme";
type Listener = (theme: Theme) => void;
type DarkPreference = Pick<MediaQueryList, "matches" | "addEventListener">;

function readDarkPreference(): DarkPreference {
  return typeof matchMedia === "function"
    ? matchMedia("(prefers-color-scheme: dark)")
    : { matches: false, addEventListener: () => undefined };
}

function validTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return validTheme(value) ? value : null;
  } catch {
    return null;
  }
}

let explicitTheme = readStoredTheme();
const media = readDarkPreference();
let currentTheme: Theme = explicitTheme ?? (media.matches ? "dark" : "light");
const listeners = new Set<Listener>();

function apply(theme: Theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  for (const listener of listeners) listener(theme);
}

apply(currentTheme);

media.addEventListener?.("change", (event) => {
  if (!explicitTheme) apply(event.matches ? "dark" : "light");
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  explicitTheme = validTheme(event.newValue) ? event.newValue : null;
  if (explicitTheme) apply(explicitTheme);
  else apply(media.matches ? "dark" : "light");
});

export function getTheme(): Theme {
  return currentTheme;
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleTheme(): Theme {
  explicitTheme = currentTheme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(STORAGE_KEY, explicitTheme);
  } catch {
    // Keep the explicit choice for this page session when storage is unavailable.
  }
  apply(explicitTheme);
  return currentTheme;
}
