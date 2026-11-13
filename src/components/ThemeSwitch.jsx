import { useSyncExternalStore } from "react";
import { getThemeChoice, setThemeChoice, subscribeThemeChoice } from "../lib/theme.js";

const OPTIONS = [
  { id: "auto", label: "Auto", hint: "Follow this device's light or dark setting" },
  { id: "paper", label: "Paper", hint: "Light print" },
  { id: "ink", label: "Ink", hint: "Dark print" },
];

/** Paper / Ink / Auto. Remembered in this browser; applies to the whole app at once. */
export default function ThemeSwitch({ className = "" }) {
  const choice = useSyncExternalStore(subscribeThemeChoice, getThemeChoice, () => "auto");
  return (
    <div className={`theme-switch ${className}`} role="group" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`theme-switch-option theme-switch-${option.id}`}
          aria-pressed={choice === option.id}
          title={option.hint}
          onClick={() => setThemeChoice(option.id)}
        >
          <span className="theme-switch-swatch" aria-hidden="true" />
          {option.label}
        </button>
      ))}
    </div>
  );
}
