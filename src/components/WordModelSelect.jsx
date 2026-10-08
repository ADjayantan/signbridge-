export default function WordModelSelect({ value, onChange, disabled = false }) {
  return <label className="field">Word recognition model<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value="legacy">Current experimental word model</option>
    <option value="graph">Evaluated 75-joint model (local availability)</option>
  </select><span className="fine-print">The new joint model requires passed evaluation and device checks. Unsupported or uncertain signs still need a reviewed meaning.</span></label>;
}
