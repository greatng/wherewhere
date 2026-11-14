import { Button } from "./ui/Button";
import { useEffect, useState } from "preact/hooks";
import { getTheme, subscribeTheme, toggleTheme } from "./theme";

type Props = { thai?: boolean };

export function ThemeToggle({ thai = false }: Props) {
  const [theme, setTheme] = useState(getTheme);
  useEffect(() => subscribeTheme(setTheme), []);
  const dark = theme === "dark";
  return (
    <Button
      class="theme-toggle"
      type="button"
      aria-label={
        dark
          ? thai
            ? "เปลี่ยนเป็นโหมดสว่าง"
            : "Switch to light mode"
          : thai
            ? "เปลี่ยนเป็นโหมดมืด"
            : "Switch to dark mode"
      }
      onClick={toggleTheme}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" />
        </svg>
      )}
    </Button>
  );
}
