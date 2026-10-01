import { LANGUAGES } from "../lib/languages.js";

export function LanguageSelect({ value, onChange, id = "language" }) {
  return (
    <div className="field">
      <label htmlFor={id}>Reply language</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.bcp47}>
            {l.native === l.name ? l.name : `${l.native} (${l.name})`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Switch({ checked, onChange, children, description }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-text">
        {children}
        {description && <span className="switch-description">{description}</span>}
      </span>
    </label>
  );
}

export function TopBar({ title, titleId, onBack, children }) {
  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost back" onClick={onBack}>
        <span aria-hidden="true">←</span> Home
      </button>
      <h1 id={titleId} className="topbar-title" tabIndex={-1}>
        {title}
      </h1>
      <div className="topbar-extra">{children}</div>
    </header>
  );
}

/** True when a key event comes from a text field, where shortcuts must not fire. */
export function isTyping(event) {
  const el = event.target;
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}
