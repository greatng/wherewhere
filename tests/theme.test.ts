import { beforeEach, describe, expect, it, vi } from "vitest";

function mediaQuery(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  return {
    query: {
      get matches() { return matches; },
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
    },
    set(value: boolean) {
      matches = value;
      listeners.forEach((listener) => listener({ matches }));
    },
  };
}

describe("theme preference", () => {
  let media: ReturnType<typeof mediaQuery>;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    media = mediaQuery(false);
    vi.stubGlobal("matchMedia", () => media.query);
  });

  it("uses the system setting by default and follows later changes", async () => {
    media = mediaQuery(true);
    vi.stubGlobal("matchMedia", () => media.query);
    const theme = await import("../src/shared/theme");
    expect(theme.getTheme()).toBe("dark");
    media.set(false);
    expect(theme.getTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ignores invalid saved values", async () => {
    localStorage.setItem("paikan-theme", "sepia");
    const theme = await import("../src/shared/theme");
    expect(theme.getTheme()).toBe("light");
  });

  it("persists an explicit choice and keeps it when the system changes", async () => {
    const theme = await import("../src/shared/theme");
    expect(theme.toggleTheme()).toBe("dark");
    expect(localStorage.getItem("paikan-theme")).toBe("dark");
    media.set(false);
    expect(theme.getTheme()).toBe("dark");

    vi.resetModules();
    const reloaded = await import("../src/shared/theme");
    expect(reloaded.getTheme()).toBe("dark");
  });

  it("keeps working when local storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const theme = await import("../src/shared/theme");
    expect(theme.toggleTheme()).toBe("dark");
    expect(theme.getTheme()).toBe("dark");
  });

  it("clears a saved choice for System and follows OS changes again", async () => {
    localStorage.setItem("paikan-theme", "dark");
    const theme = await import("../src/shared/theme");
    expect(theme.getThemePreference()).toBe("dark");

    expect(theme.setThemePreference("system")).toBe("light");
    expect(theme.getThemePreference()).toBe("system");
    expect(localStorage.getItem("paikan-theme")).toBeNull();
    media.set(true);
    expect(theme.getTheme()).toBe("dark");
  });

  it("persists a selected choice and synchronizes it with the header toggle", async () => {
    const theme = await import("../src/shared/theme");
    theme.setThemePreference("dark");
    expect(localStorage.getItem("paikan-theme")).toBe("dark");
    expect(theme.getThemePreference()).toBe("dark");
    theme.toggleTheme();
    expect(theme.getThemePreference()).toBe("light");
  });
});
