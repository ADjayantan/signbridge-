import { LANGUAGES } from "../lib/languages.js";

export function CameraSelect({ camera, value, onChange, disabled = false, id = "camera-device" }) {
  if (!camera.devices?.length) return null;
  return <div className="field"><label htmlFor={id}>Camera device</label><select id={id} value={value || camera.selectedDeviceId || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
    <option value="">Automatic · prefer laptop webcam</option>
    {camera.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
  </select><p className="fine-print">Choose Integrated Camera for the laptop. Phone and virtual cameras are listed separately.</p></div>;
}

export function LanguageSelect({ value, onChange, id = "language", label = "Reply language" }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
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

export function Switch({ checked, onChange, children, description, disabled = false }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
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
