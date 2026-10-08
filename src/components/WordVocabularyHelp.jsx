import { useId, useState } from "react";

const normalize = (text) => text.trim().replace(/\s+/g, " ").toUpperCase();

/** Read-only vocabulary lookup. This query never enters recognition or a message. */
export default function WordVocabularyHelp({ model, signLanguage, engine = "legacy", disabled = false }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const labels = Array.isArray(model?.labels) ? model.labels : [];
  if (!labels.length || (model.signLanguage && model.signLanguage !== signLanguage)) return null;
  const normalized = normalize(query);
  const supported = labels.find((label) => normalize(label) === normalized);
  const matches = labels.filter((label) => normalize(label).includes(normalized));
  return <section className="word-vocabulary-help workspace-quality" aria-label="Loaded word vocabulary">
    <h3>Check supported words</h3>
    <p><strong>{model.signLanguage ? "Loaded" : "Selected"} {signLanguage.toUpperCase()} word model</strong> · {labels.length} words · {engine === "graph" ? "75-joint recognition" : "experimental movement recognition"}</p>
    <label className="field" htmlFor={`${id}-query`}>Find a word in this model
      <input id={`${id}-query`} type="text" value={query} disabled={disabled} maxLength={80} list={`${id}-words`} aria-describedby={`${id}-help ${id}-status`} placeholder="Check a word before signing…" onChange={(event) => setQuery(event.target.value)} />
    </label>
    <datalist id={`${id}-words`}>{labels.map((label) => <option key={label} value={label} />)}</datalist>
    <p id={`${id}-status`} aria-label="Word vocabulary check" aria-live="polite">{!normalized ? "Choose your sign language first, then check the word before capturing." : supported ? `${supported} is in this ${signLanguage.toUpperCase()} model's vocabulary. Recognition is experimental and may reject or misread a turn.` : `${query.trim()} is not in this ${signLanguage.toUpperCase()} model's vocabulary. This model cannot return that word.`}</p>
    <p id={`${id}-help`} className="fine-print">ISL and ASL are different languages. This search checks vocabulary only; it does not tell the model what to predict, change your reviewed text, or teach a new sign.</p>
    <details><summary>{normalized ? `${matches.length} matching supported words` : `All ${labels.length} supported words`}</summary><p className="hint">{matches.length ? matches.join(" · ") : "No matching labels. Try a word from the available vocabulary."}</p></details>
  </section>;
}
