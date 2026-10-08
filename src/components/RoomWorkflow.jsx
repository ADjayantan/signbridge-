import { useRef, useState } from "react";
import { canSpeak } from "../lib/speech.js";
import { language } from "../lib/languages.js";
import { meetingSummary, messageSummary, referenceSummary } from "../lib/roomWorkflow.js";
import SignVideoPlayer from "./SignVideoPlayer.jsx";

const sourceLabel = { text: "Typed", speech: "Reviewed speech", sign: "Reviewed sign" };
const reasonText = { repeat: "Please repeat or rephrase this message", "time-place": "Which time or place do you mean?" };

function useReviewedAction(sendAction) {
  const retry = useRef(null);
  const busy = useRef(false);
  const [state, setState] = useState({ busy: false, error: "", code: "" });
  const submit = async (payload) => {
    if (busy.current) return { ok: false };
    busy.current = true;
    const signature = JSON.stringify(payload);
    setState({ busy: true, error: "", code: "" });
    try {
      const result = await sendAction({ ...payload, ...(retry.current?.signature === signature ? { id: retry.current.id } : {}) });
      retry.current = !result.ok && result.uncertain && result.id ? { id: result.id, signature } : null;
      setState({ busy: false, error: result.ok ? "" : result.error || "This action was not confirmed. Review and retry after reconnecting.", code: result.code || "" });
      busy.current = false;
      return result;
    } catch {
      setState({ busy: false, error: "This action could not be confirmed. Your form is kept.", code: "" });
      busy.current = false;
      return { ok: false };
    }
  };
  return [state, submit, () => setState({ busy: false, error: "", code: "" })];
}

export function RoomMessage({ message, messages, clarifications, participantId, connected, sendAction, lang, onCompose, onRead }) {
  const mine = message.senderId === participantId || (!message.senderId && message.outgoing);
  const delivery = message.delivery === "received" ? mine ? "Received on partner’s device" : "Received on this device"
    : message.delivery === "uncertain" ? "Delivery uncertain — retry with the same draft"
    : message.delivery === "pending" ? "Sending…" : mine ? "Sent" : "Received";
  const [asking, setAsking] = useState(false), [reason, setReason] = useState("repeat"), [question, setQuestion] = useState("");
  const [action, submit] = useReviewedAction(sendAction);
  const requests = (clarifications || []).filter((item) => item.messageId === message.id);
  const target = messages.find((item) => item.id === message.relation?.messageId);
  const request = async (event) => {
    event.preventDefault();
    const result = await submit({ kind: "clarification.request", messageId: message.id, reason, question: reason === "question" ? question.trim() : reasonText[reason], lang });
    if (result.ok) { setAsking(false); setQuestion(""); }
  };
  return <article id={`room-message-${message.id}`} tabIndex={-1} className={`room-message ${mine ? "mine" : "theirs"}`}>
    <div className="room-message-label"><strong>{mine ? "You" : "Partner"}</strong><span>{sourceLabel[message.inputMethod] || "Message"}{message.signLanguage ? ` · ${message.signLanguage.toUpperCase()}` : ""}</span></div>
    {message.relation && <p className="room-link-context">{message.relation.kind === "correction" ? "Correction to" : "Answer about"} {target ? <a href={`#room-message-${target.id}`} onClick={(event) => { event.preventDefault(); const original = document.getElementById(`room-message-${target.id}`); original?.scrollIntoView({ block: "nearest" }); original?.focus({ preventScroll: true }); }}>{target.text.slice(0, 90)}</a> : "an earlier message no longer in this history"}. Original wording is retained.</p>}
    <p lang={language(message.lang).bcp47}>{message.text}</p>
    {message.references?.length > 0 && <ul className="room-attached-references" aria-label="References saved with this message">{message.references.map((reference) => <li key={reference.id}><strong>{reference.label}</strong> · revision {reference.revision}<p>{reference.description}</p></li>)}</ul>}
    <div className="room-message-meta"><span>{delivery}</span><div className="room-message-actions">{canSpeak && <button type="button" className="room-inline-button" aria-label={`Read message aloud: ${message.text.slice(0, 40)}`} onClick={() => onRead({ text: messageSummary(message, messages), lang: message.lang })}>Read aloud</button>}{message.senderId && message.delivery !== "pending" && message.delivery !== "uncertain" && (mine ? <button type="button" className="room-inline-button" onClick={() => onCompose({ kind: "correction", messageId: message.id })}>Correct message</button> : <button type="button" className="room-inline-button" disabled={!connected} onClick={() => setAsking(!asking)}>Clarify this</button>)}</div></div>
    {asking && <form className="room-clarify-form" onSubmit={request}><label className="field">What needs clarification?<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="repeat">Repeat or rephrase</option><option value="time-place">Which time/place?</option><option value="question">Ask a question</option></select></label>{reason === "question" && <label className="field">Your clarification question<input maxLength={1000} required value={question} onChange={(event) => setQuestion(event.target.value)} /></label>}<div className="actions"><button className="btn btn-small" disabled={!connected || action.busy || (reason === "question" && !question.trim())}>{action.busy ? "Sending request…" : "Send clarification request"}</button><button className="room-inline-button" type="button" onClick={() => setAsking(false)}>Cancel request</button></div></form>}
    {requests.map((item) => <div className="room-clarification" key={item.id}><p><strong>{item.requesterId === participantId ? "You asked" : "Partner asked"}:</strong> {item.question || reasonText[item.reason]}</p>{item.status === "resolved" ? <p className="fine-print">{item.requesterId === participantId ? "You marked this resolved" : "Partner marked this resolved"}</p> : <><p className="fine-print">Clarification open</p><div className="actions">{mine && <button type="button" className="btn btn-small" onClick={() => onCompose({ kind: "answer", messageId: message.id, clarificationId: item.id })}>Answer in reviewed draft</button>}{item.requesterId === participantId && <button type="button" className="room-inline-button" disabled={!connected || action.busy} onClick={() => void submit({ kind: "clarification.resolve", clarificationId: item.id })}>Mark request resolved</button>}</div></>}</div>)}
    {action.error && <p className="error" role="alert">{action.error}</p>}
  </article>;
}

const emptyFields = () => ({ date: "", time: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", place: "", note: "" });
function MeetingFields({ fields, onChange, prefix }) {
  return <div className="room-meeting-fields">{[["date", "Date", "date", 10], ["time", "Time", "time", 5], ["timeZone", "Time zone", "text", 80], ["place", "Place", "text", 200], ["note", "Note", "text", 1000]].map(([key, label, type, limit]) => <label className="field" key={key} htmlFor={`${prefix}-${key}`}>{label}{key !== "note" && <span className="fine-print"> required</span>}<input id={`${prefix}-${key}`} type={type} required={key !== "note"} value={fields[key] || ""} maxLength={limit} onChange={(event) => onChange({ ...fields, [key]: event.target.value })} /></label>)}</div>;
}
export function MeetingCard({ card, participantId, connected, sendAction, lang, onRead, clips, signLanguage, showSignVideos }) {
  const [editing, setEditing] = useState(null), [needsReview, setNeedsReview] = useState(false);
  const [action, submit, clear] = useReviewedAction(sendAction);
  const mine = card.approvals?.includes(participantId), both = new Set(card.approvals || []).size === 2;
  const approve = async () => { const result = await submit({ kind: "meeting.approve", cardId: card.id, revision: card.revision }); if (!result.ok && /revision|stale/i.test(`${result.code} ${result.error}`)) setNeedsReview(true); };
  const revise = async (event) => { event.preventDefault(); const result = await submit({ kind: "meeting.revise", cardId: card.id, baseRevision: editing.revision, fields: editing.fields, lang }); if (result.ok) setEditing(null); else if (/revision|stale/i.test(`${result.code} ${result.error}`)) setNeedsReview(true); };
  const review = () => { setNeedsReview(false); if (editing) setEditing({ revision: card.revision, fields: { ...card.fields } }); clear(); };
  return <article className="room-meeting-card" aria-label={`Meeting details revision ${card.revision}`}><div className="room-panel-heading"><h4>Meeting details</h4><span>Revision {card.revision}</span></div><dl>{[["date", "Date"], ["time", "Time"], ["timeZone", "Time zone"], ["place", "Place"], ["note", "Note"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{card.fields[key] || "Not specified"}</dd></div>)}</dl><p className="room-card-status">{both ? "Both approved these details" : mine ? "You approved this revision · partner approval pending" : card.approvals?.length ? "Partner approved this revision · your approval pending" : "Awaiting both approvals"}</p><div className="actions">{canSpeak && <button type="button" className="room-inline-button" onClick={() => onRead({ text: meetingSummary(card), lang: card.lang })}>Read all meeting details aloud</button>}<button type="button" className="btn btn-small" disabled={!connected || mine || action.busy || needsReview || Boolean(editing)} onClick={approve}>{action.busy && !editing ? "Sending approval…" : mine ? "You approved this revision" : `Approve revision ${card.revision}`}</button><button type="button" className="room-inline-button" disabled={!connected || action.busy} onClick={() => { setEditing({ revision: card.revision, fields: { ...card.fields } }); setNeedsReview(false); clear(); }}>Propose an edit</button></div>
    {editing && <form className="room-workflow-form" onSubmit={revise}><p className="fine-print">Editing revision {editing.revision}. Saving creates a new revision and clears both approvals.</p><MeetingFields prefix={`meeting-edit-${card.id}`} fields={editing.fields} onChange={(fields) => setEditing({ ...editing, fields })} /><div className="actions"><button className="btn btn-small" disabled={!connected || action.busy || needsReview || !editing.fields.place.trim()}>Save new revision</button><button className="room-inline-button" type="button" onClick={() => { setEditing(null); setNeedsReview(false); clear(); }}>Cancel edit</button></div></form>}
    {needsReview && <div className="room-notice"><p>The details changed. Review the current revision before editing or approving again.</p><button className="btn btn-small" type="button" disabled={!connected} onClick={review}>Review current revision {card.revision}</button></div>}{action.error && <p className="error" role="alert">{action.error}</p>}
    {card.history?.length > 0 && <details className="room-revision-history"><summary>Previous revisions</summary>{card.history.filter((entry) => entry.revision !== card.revision).map((entry) => <div key={entry.revision}><strong>Revision {entry.revision}</strong><p>{meetingSummary({ ...entry, approvals: [] }).replace(/\. Awaiting both approvals\.$/, ". Approval status belongs to the current revision.")}</p></div>)}</details>}
    {showSignVideos && <details className="room-revision-history"><summary>Available saved sign clips for these details</summary><SignVideoPlayer key={`${card.id}:${card.revision}:${signLanguage}`} text={meetingSummary(card)} clips={clips || []} signLanguage={signLanguage} textLanguage={card.lang} /></details>}
  </article>;
}

export function MeetingSection({ cards, participantId, connected, sendAction, lang, onRead, clips, signLanguage, showSignVideos }) {
  const [creating, setCreating] = useState(false), [fields, setFields] = useState(emptyFields);
  const [action, submit] = useReviewedAction(sendAction);
  const create = async (event) => { event.preventDefault(); const result = await submit({ kind: "meeting.create", fields, lang }); if (result.ok) { setCreating(false); setFields(emptyFields()); } };
  return <section className="room-workflow-section" aria-label="Shared meeting details"><div className="room-panel-heading"><h3>Review a plan together</h3><button className="btn btn-small" type="button" disabled={!connected || action.busy} onClick={() => setCreating(!creating)}>Add meeting details</button></div><p className="fine-print">Optional shared details. Each person approves only the revision they review. Ordinary messages need no approval.</p>{creating && <form className="room-workflow-form" onSubmit={create}><MeetingFields prefix="meeting-create" fields={fields} onChange={setFields} /><div className="actions"><button className="btn btn-small" disabled={!connected || action.busy || !fields.place.trim()}>{action.busy ? "Sending details…" : "Share meeting details"}</button><button className="room-inline-button" type="button" onClick={() => setCreating(false)}>Cancel meeting details</button></div></form>}{action.error && <p className="error" role="alert">{action.error}</p>}{cards.map((card) => <MeetingCard key={card.id} {...{ card, participantId, connected, sendAction, lang, onRead, clips, signLanguage, showSignVideos }} />)}</section>;
}

function ReferenceCard({ reference, connected, sendAction, lang, onRead }) {
  const [editing, setEditing] = useState(null), [needsReview, setNeedsReview] = useState(false);
  const [action, submit, clear] = useReviewedAction(sendAction);
  const save = async (event) => { event.preventDefault(); const result = await submit({ kind: "reference.revise", referenceId: reference.id, baseRevision: editing.revision, label: editing.label.trim(), description: editing.description.trim(), lang }); if (result.ok) setEditing(null); else if (/revision|stale/i.test(`${result.code} ${result.error}`)) setNeedsReview(true); };
  return <article className="room-reference-card"><strong>{reference.label}</strong><span className="fine-print"> · revision {reference.revision}</span><p>{reference.description}</p><div className="actions">{canSpeak && <button className="room-inline-button" type="button" onClick={() => onRead({ text: referenceSummary(reference), lang: reference.lang })}>Read reference aloud</button>}<button className="room-inline-button" type="button" disabled={!connected || action.busy} onClick={() => { setEditing({ ...reference }); setNeedsReview(false); clear(); }}>Edit reference</button></div>{editing && <form className="room-workflow-form" onSubmit={save}><label className="field">Reference label<input maxLength={120} required value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} /></label><label className="field">Reference description<input maxLength={1000} required value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><div className="actions"><button className="btn btn-small" disabled={!connected || action.busy || needsReview || !editing.label.trim() || !editing.description.trim()}>Save reference revision</button><button className="room-inline-button" type="button" onClick={() => { setEditing(null); setNeedsReview(false); clear(); }}>Cancel reference edit</button></div></form>}{needsReview && <button type="button" className="btn btn-small" disabled={!connected} onClick={() => { setEditing({ ...reference }); setNeedsReview(false); clear(); }}>Review current reference revision {reference.revision}</button>}{action.error && <p className="error" role="alert">{action.error}</p>}</article>;
}

export function ReferencesSection({ references, connected, sendAction, lang, onRead }) {
  const [creating, setCreating] = useState(false), [label, setLabel] = useState(""), [description, setDescription] = useState("");
  const [action, submit] = useReviewedAction(sendAction);
  const create = async (event) => { event.preventDefault(); const result = await submit({ kind: "reference.create", label: label.trim(), description: description.trim(), lang }); if (result.ok) { setCreating(false); setLabel(""); setDescription(""); } };
  return <details className="room-workflow-section"><summary>Shared references <span className="fine-print">{references.length} labeled items</span></summary><p className="fine-print">Give “this” or “that” a label and description. A sent message keeps its reference wording even if the label changes later.</p><button className="btn btn-small" type="button" disabled={!connected || action.busy} onClick={() => setCreating(!creating)}>Add a shared reference</button>{creating && <form className="room-workflow-form" onSubmit={create}><label className="field">New reference label<input required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Entrance B" /></label><label className="field">New reference description<input required maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Library entrance beside the main road" /></label><div className="actions"><button className="btn btn-small" disabled={!connected || action.busy || !label.trim() || !description.trim()}>{action.busy ? "Sending reference…" : "Share reference"}</button><button className="room-inline-button" type="button" onClick={() => setCreating(false)}>Cancel new reference</button></div></form>}{action.error && <p className="error" role="alert">{action.error}</p>}{references.map((reference) => <ReferenceCard key={reference.id} {...{ reference, connected, sendAction, lang, onRead }} />)}</details>;
}
