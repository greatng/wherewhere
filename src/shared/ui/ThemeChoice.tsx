import { useEffect, useState } from "preact/hooks";
import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from "../theme";

type Props = { thai?: boolean };

const options: Array<{
  value: ThemePreference;
  english: string;
  thai: string;
}> = [
  { value: "light", english: "Light", thai: "สว่าง" },
  { value: "dark", english: "Dark", thai: "มืด" },
  { value: "system", english: "System", thai: "ตามระบบ" },
];

function OptionIcon({ value }: { value: ThemePreference }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {value === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
        </>
      ) : null}
      {value === "dark" ? (
        <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" />
      ) : null}
      {value === "system" ? (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4" />
        </>
      ) : null}
    </svg>
  );
}

// Adapted from 21st.dev @campsite/theme-toggle (component 554): retain its Light, Dark, System choices and selected treatment in a compact native radio group.
export function ThemeChoice({ thai = false }: Props) {
  const [selected, setSelected] = useState(getThemePreference);
  useEffect(() => subscribeThemePreference(setSelected), []);

  return (
    <fieldset class="theme-choice">
      <legend>{thai ? "รูปแบบธีม" : "Appearance"}</legend>
      <div class="theme-choice-options">
        {options.map(({ value, english, thai: thaiLabel }) => {
          const active = selected === value;
          const label = thai ? thaiLabel : english;
          return (
            <label key={value} class="theme-choice-option">
              <input
                type="radio"
                name="theme-choice"
                value={value}
                checked={active}
                onChange={() => setThemePreference(value)}
                aria-label={label}
              />
              <OptionIcon value={value} />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
