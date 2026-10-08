import { useCallback, useEffect, useRef, useState } from "react";
import { LanguageSelect, Switch, TopBar } from "../components/Controls.jsx";
import RoomSignCapture from "../components/RoomSignCapture.jsx";
import SignVideoPlayer from "../components/SignVideoPlayer.jsx";
import { MeetingSection, ReferencesSection, RoomMessage } from "../components/RoomWorkflow.jsx";
import { useRoom } from "../hooks/useRoom.js";
import { useRoomMedia } from "../hooks/useRoomMedia.js";
import { useCommunicationPreferences } from "../hooks/useCommunicationPreferences.js";
import { useSignVideos } from "../hooks/useSignVideos.js";
import { canListen, canSpeak, createSpeaker, listenErrorMessage, listenOnce, speakErrorMessage } from "../lib/speech.js";
import { language } from "../lib/languages.js";
import { messageSummary, workflowEventSummary } from "../lib/roomWorkflow.js";
import "../styles/connect.css";
import "../styles/roomWorkflow.css";

const EMPTY_DRAFT = { text: "", lang: "en", inputMethod: "text", referenceIds: [] };
const DRAFT_KEY = "signbridge:conversation-draft";
function actualDraftSource(next) {
  const { signLanguage, ...draft } = next;
  if (!draft.text) draft.inputMethod = "text";
  return { ...draft, ...(draft.inputMethod === "sign" && signLanguage ? { signLanguage } : {}) };
}
function loadDraft() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
    if (typeof saved?.text === "string" && saved.text.length <= 2000 && ["text", "speech", "sign"].includes(saved.inputMethod)) return actualDraftSource({ ...EMPTY_DRAFT, ...saved, lang: language(saved.lang).code, referenceIds: Array.isArray(saved.referenceIds) ? saved.referenceIds.filter((id) => typeof id === "string").slice(0, 3) : [] });
  } catch { /* Session storage is optional. */ }
  return { ...EMPTY_DRAFT };
}
const statusLabel = { idle: "Ready to connect", creating: "Starting a conversation…", joining: "Joining your partner…", connecting: "Connecting…", connected: "Room connected", reconnecting: "Reconnecting — your draft is safe", ended: "Room ended", error: "Connection needs attention" };
const sourceLabel = { text: "Typed", speech: "Reviewed speech", sign: "Reviewed sign" };

function incomingDraftState(text) {
  const current = loadDraft();
  const incoming = typeof text === "string" && text.trim() ? text : null;
  const placed = Boolean(incoming && incoming.length <= 2000 && !current.text.trim());
  return { draft: placed ? { ...EMPTY_DRAFT, text: incoming } : current, incoming: placed ? null : incoming, placed };
}

export default function ConnectMode({ settings, onBack, onTool, initialReviewedText, onReviewedTextConsumed }) {
  const room = useRoom();
  const media = useRoomMedia(room);
  const [preferences, updatePreferences] = useCommunicationPreferences();
  const [transferState] = useState(() => incomingDraftState(initialReviewedText));
  const [draft, setDraft] = useState(transferState.draft);
  const [incomingText, setIncomingText] = useState(transferState.incoming);
  const [transferPlaced, setTransferPlaced] = useState(transferState.placed);
  const [invite, setInvite] = useState(() => window.location.hash.includes("invite=") ? window.location.href : "");
  const [entryAction, setEntryAction] = useState(() => window.location.hash.includes("invite=") || new URLSearchParams(window.location.hash.split("?")[1] || "").get("action") === "join" ? "join" : "create");
  const [localError, setLocalError] = useState("");
  const [copied, setCopied] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [recognition, setRecognition] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [announcement, setAnnouncement] = useState(0);
  const [ai, setAI] = useState({ busy: false, reply: "", error: "" });
  const videos = useSignVideos();
  const [speaker] = useState(createSpeaker);
  const mic = useRef(null), micEpoch = useRef(0), speakEpoch = useRef(0), mounted = useRef(true), aiAbort = useRef(null);
  const seen = useRef(new Set()), outputRoom = useRef(""), initialSnapshot = useRef(false), snapshotSeen = useRef(-1), speechQueue = useRef([]);
  const draftRef = useRef(draft), revision = useRef(0), retryMessage = useRef(null), undo = useRef([]);
  const chatList = useRef(null), followConversation = useRef(true);
  draftRef.current = draft;
  const busyEntry = ["creating", "joining", "connecting"].includes(room.status);
  const activeRoom = Boolean(room.roomId) && !["idle", "ended", "error"].includes(room.status);
  const peerOnline = room.participants?.some((participant) => participant.id !== room.participantId && participant.online);
  const messages = room.messages || [];
  const workflow = room.workflow || { events: [], clarifications: [], cards: [], references: [] };
  const connected = room.status === "connected";
  const draftTarget = messages.find((message) => message.id === draft.relation?.messageId);
  const lastReceived = messages.findLast((message) => message.senderId && message.senderId !== room.participantId);
  const latestMessage = messages.at(-1);
  const incomingCombinedLength = incomingText ? [draft.text.trim(), incomingText.trim()].filter(Boolean).join(" ").length : 0;

  useEffect(() => { if (transferState.placed) onReviewedTextConsumed?.(); }, []);

  useEffect(() => {
    const list = chatList.current;
    if (list && (followConversation.current || latestMessage?.senderId === room.participantId)) list.scrollTop = list.scrollHeight;
  }, [latestMessage?.id, room.participantId]);
  const showLatest = () => { followConversation.current = true; if (chatList.current) chatList.current.scrollTop = chatList.current.scrollHeight; };

  useEffect(() => {
    document.title = "Connect your way · SignBridge";
    document.getElementById("connect-title")?.focus(); mounted.current = true;
    return () => { mounted.current = false; micEpoch.current++; mic.current?.abort(); speaker.cancel(); aiAbort.current?.abort(); };
  }, [speaker]);
  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* Keep the in-memory draft. */ } }, [draft]);

  const editDraft = useCallback((next, remember = true) => {
    if (next.text.length > 2000) { setLocalError("Messages can contain up to 2,000 characters. Edit the draft before adding more."); return false; }
    next = actualDraftSource(next);
    if (remember && next.text !== draftRef.current.text) undo.current = [...undo.current, draftRef.current].slice(-30);
    revision.current++; draftRef.current = next; setDraft(next); setLocalError(""); retryMessage.current = null;
    return true;
  }, []);
  const append = useCallback((addition) => {
    const current = draftRef.current;
    return editDraft({ ...current, ...addition, text: [current.text.trim(), addition.text.trim()].filter(Boolean).join(" ") });
  }, [editDraft]);
  const clearDraftContext = useCallback(() => {
    undo.current = [];
    retryMessage.current = null;
    const current = draftRef.current;
    if (current.relation || current.referenceIds?.length || current.roomId) {
      const { relation: _relation, roomId: _roomId, ...plain } = current;
      editDraft({ ...plain, referenceIds: [] }, false);
    }
  }, [editDraft]);
  useEffect(() => {
    if (room.status === "ended" || (draft.roomId && room.roomId && room.roomId !== draft.roomId)) clearDraftContext();
  }, [room.roomId, room.status, draft.roomId, clearDraftContext]);
  const composeRelated = (relation) => {
    editDraft({ ...draftRef.current, roomId: room.roomId, relation }, false);
    document.getElementById("room-draft")?.focus();
  };
  const stopListening = useCallback(() => { micEpoch.current++; mic.current?.abort(); mic.current = null; setListening(false); setInterim(""); }, []);
  const stopSpeech = useCallback(() => { speakEpoch.current++; speechQueue.current = []; speaker.cancel(); setSpeaking(false); setSpeechStatus(""); }, [speaker]);
  const quietRemoteAudio = useCallback(() => {
    if (media.remoteVideoRef.current) media.remoteVideoRef.current.muted = true;
    media.setRemoteAudioEnabled(false);
  }, [media.remoteVideoRef, media.setRemoteAudioEnabled]);
  const readMessage = useCallback(async (message) => {
    if (!canSpeak) { setLocalError("Read aloud is unavailable in this browser. Your reviewed text is still usable."); return; }
    if (!message.text?.trim()) return;
    stopListening(); quietRemoteAudio(); media.disableMic();
    const epoch = ++speakEpoch.current; speaker.cancel(); setSpeaking(true); setLocalError(""); setSpeechStatus("Starting read aloud…");
    let failed = false;
    const reportError = (code) => {
      failed = true;
      if (mounted.current && epoch === speakEpoch.current) { setLocalError(speakErrorMessage(code)); setSpeechStatus(""); }
    };
    try {
      const result = await speaker.speak(message.text, {
        lang: language(message.lang).bcp47, rate: settings.rate,
        onStart: () => { if (mounted.current && epoch === speakEpoch.current) setSpeechStatus("Reading aloud on this device…"); },
        onError: reportError,
      });
      if (mounted.current && epoch === speakEpoch.current) {
        if (result?.status === "error" && !failed) reportError(result.code);
        setSpeaking(false);
        if (!failed) setSpeechStatus(result?.status === "cancelled" ? "" : "Read-aloud playback ended.");
      }
    } catch {
      reportError("synthesis-failed");
      if (mounted.current && epoch === speakEpoch.current) setSpeaking(false);
    }
  }, [speaker, settings.rate, stopListening, quietRemoteAudio, media.disableMic]);

  const captureActivity = (active) => { setCapturing(active); if (active) { stopListening(); stopSpeech(); } };

  useEffect(() => {
    if (outputRoom.current !== room.roomId) { outputRoom.current = room.roomId; seen.current = new Set(); initialSnapshot.current = false; snapshotSeen.current = -1; speechQueue.current = []; setLiveText(""); }
    if (room.status !== "connected") return;
    const outputs = [...messages.map((message) => ({ id: `message:${message.id}`, actorId: message.senderId, seq: message.seq, text: messageSummary(message, messages), lang: message.lang })), ...(workflow.events || []).map((event) => ({ ...event, id: `event:${event.id}`, text: workflowEventSummary(event, messages) }))].sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const snapshotChanged = typeof room.snapshotVersion === "number" && snapshotSeen.current !== room.snapshotVersion;
    if (!initialSnapshot.current || snapshotChanged) { outputs.forEach((output) => seen.current.add(output.id)); initialSnapshot.current = true; snapshotSeen.current = room.snapshotVersion; speechQueue.current = []; return; }
    const incoming = outputs.filter((output) => output.actorId && output.actorId !== room.participantId && !seen.current.has(output.id));
    outputs.forEach((output) => seen.current.add(output.id));
    if (preferences.receive === "screenreader" && incoming.length) { setLiveText(incoming.map((output) => `Partner: ${output.text}`).join(". ")); setAnnouncement((value) => value + 1); }
    if (preferences.receive === "speech") speechQueue.current.push(...incoming);
    if (preferences.receive === "speech" && !listening && !speaking && speechQueue.current.length) { const next = speechQueue.current.shift(); void readMessage(next); }
  }, [messages, workflow.events, room.snapshotVersion, room.roomId, room.participantId, room.status, preferences.receive, listening, speaking, readMessage]);
  useEffect(() => { stopListening(); stopSpeech(); setLiveText(""); quietRemoteAudio(); }, [preferences.receive]);
  useEffect(() => { stopListening(); stopSpeech(); }, [preferences.inputMethod, preferences.lang, preferences.signLanguage]);
  useEffect(() => {
    if (room.status === "ended") { stopListening(); stopSpeech(); aiAbort.current?.abort(); setAI({ busy: false, reply: "", error: "" }); setRecognition(false); media.stop(); }
  }, [room.status]);

  const dictate = () => {
    if (!canListen || listening || capturing) return;
    stopSpeech(); quietRemoteAudio(); media.disableMic();
    const epoch = ++micEpoch.current, lang = preferences.lang;
    setLocalError(""); setListening(true); setInterim("");
    try {
      mic.current = listenOnce({ lang: language(lang).bcp47,
        onInterim: (text) => { if (mounted.current && epoch === micEpoch.current) setInterim(text); },
        onEnd: (text) => { if (!mounted.current || epoch !== micEpoch.current) return; mic.current = null; setListening(false); setInterim(""); if (text) append({ text, lang, inputMethod: "speech" }); },
        onError: (code) => { if (mounted.current && epoch === micEpoch.current) { setLocalError(listenErrorMessage(code)); stopListening(); } },
      });
    } catch { stopListening(); setLocalError("Dictation could not start. You can keep typing your message."); }
  };
  const send = async (event) => {
    event.preventDefault();
    if (room.status !== "connected" || !draft.text.trim() || sending || listening || capturing) return;
    const { roomId: _contextRoomId, ...content } = draft;
    const snapshot = { ...content, text: draft.text.trim() }, version = revision.current;
    const signature = JSON.stringify(snapshot);
    const id = retryMessage.current?.signature === signature ? retryMessage.current.id : undefined;
    setSending(true); setLocalError("");
    try {
      const result = await room.send({ ...snapshot, ...(id ? { id } : {}) });
      if (!mounted.current) return;
      if (result.ok) { if (revision.current === version) editDraft({ ...EMPTY_DRAFT, lang: preferences.lang }); }
      else { retryMessage.current = { id: result.id, signature }; setLocalError(result.error || "Delivery is uncertain. Your draft is kept; retry after reconnecting."); }
    } catch { if (mounted.current) setLocalError("Your message could not be sent. The draft is kept."); }
    finally { if (mounted.current) setSending(false); }
  };
  const askAI = async () => {
    if (!draft.text.trim() || room.status !== "connected" || ai.busy) return;
    aiAbort.current?.abort(); const controller = new AbortController(); aiAbort.current = controller;
    setAI({ busy: true, reply: "", error: "" });
    try { const reply = await room.askAI({ text: draft.text, lang: draft.lang, signal: controller.signal }); if (!controller.signal.aborted && mounted.current) setAI({ busy: false, reply: reply.reply, error: "" }); }
    catch (error) { if (!controller.signal.aborted && mounted.current) setAI({ busy: false, reply: "", error: error.message || "AI help is unavailable. Your partner conversation still works." }); }
  };
  const resetAI = () => { aiAbort.current?.abort(); aiAbort.current = null; setAI({ busy: false, reply: "", error: "" }); };
  const leave = () => { stopListening(); stopSpeech(); resetAI(); clearDraftContext(); media.stop(); room.leave(); };
  const back = () => { if (activeRoom) leave(); onBack(); };
  const create = () => { stopListening(); stopSpeech(); resetAI(); clearDraftContext(); media.stop(); setCopied(false); setLocalError(""); void room.create(); };
  const join = (event) => { event.preventDefault(); stopListening(); stopSpeech(); resetAI(); clearDraftContext(); media.stop(); setCopied(false); setLocalError(""); void room.join(invite.trim()); };
  const copyInvite = async () => { try { await navigator.clipboard.writeText(room.inviteUrl); setCopied(true); } catch { setLocalError("Select and copy the invite link below."); } };
  const setReceive = (receive) => { stopListening(); stopSpeech(); quietRemoteAudio(); updatePreferences({ receive }); };
  const useTransferredMessage = (replace) => {
    if (!incomingText || sending || capturing) return;
    const current = draftRef.current;
    const text = replace ? incomingText : [current.text.trim(), incomingText.trim()].filter(Boolean).join(" ");
    if (text.length > 2000) { setLocalError("Both messages are kept. The combined draft is longer than 2,000 characters; shorten it or choose Use this message instead."); return; }
    stopListening(); stopSpeech();
    const next = replace ? { ...EMPTY_DRAFT, ...(current.roomId ? { roomId: current.roomId } : {}), text } : { ...current, text, inputMethod: "text", lang: "en" };
    if (editDraft(next)) { setIncomingText(null); setTransferPlaced(true); onReviewedTextConsumed?.(); document.getElementById("room-draft")?.focus(); }
  };

  return <main className="mode connect-mode" aria-labelledby="connect-title">
    <TopBar title="Connect your way" titleId="connect-title" onBack={back}><span className={`room-connection ${room.status}`} role="status"><span aria-hidden="true" />{statusLabel[room.status] || room.status}</span></TopBar>
    <div className="connect-intro"><div><p className="eyebrow">One conversation. Your way to communicate.</p><h2>Meet in the middle.</h2><p>Type, speak, or sign to your partner. Choose how you receive their message.</p></div><span className="connect-human-note">People ↔ people</span></div>
    {incomingText ? <section className="room-transferred-message" aria-labelledby="room-transferred-heading"><h3 id="room-transferred-heading">Message from Sign to text &amp; voice</h3><p className="room-transferred-text">{incomingText}</p><p className="fine-print">Your existing room draft is kept. Choose how to use this reviewed text before sending. It is editable text marked as English; this copy does not prove successful sign recognition.</p><div className="actions"><button type="button" className="btn" disabled={sending || capturing || incomingCombinedLength > 2000} onClick={() => useTransferredMessage(false)}>Add to my draft</button><button type="button" className="btn" disabled={sending || capturing || incomingText.length > 2000} onClick={() => useTransferredMessage(true)}>Use this message instead</button></div>{incomingCombinedLength > 2000 && <p className="hint">Both messages are kept. Adding them would exceed 2,000 characters. Shorten your draft or choose Use this message instead.</p>}</section> : transferPlaced && draft.text && <aside className="room-transferred-message" aria-label="Reviewed message ready" role="status"><strong>Reviewed text was copied to your room draft.</strong><p className="fine-print">{activeRoom ? "Review it below, then choose Send to partner." : "Create or join a conversation to review and send it. Nothing is sent automatically."}</p>{!activeRoom && <p className="room-transferred-text">{draft.text}</p>}</aside>}
    <details className="room-preferences" open={!activeRoom}>
      <summary>Communication preferences <span>Saved on this device</span></summary>
      <div className="room-preference-grid"><fieldset><legend>Send with</legend><div className="room-choice-row">{[["text", "Type"], ["speech", "Speak"], ["sign", "Sign"]].map(([value, label]) => <label key={value} className={`room-choice ${preferences.inputMethod === value ? "selected" : ""}`}><input type="radio" name="room-input" value={value} checked={preferences.inputMethod === value} onChange={() => { stopListening(); updatePreferences({ inputMethod: value }); }} />{label}</label>)}</div></fieldset>
      <fieldset><legend>Receive as</legend><div className="room-choice-row">{[["text", "Text"], ["speech", "Read aloud"], ["screenreader", "Screen reader"]].map(([value, label]) => <label key={value} className={`room-choice ${preferences.receive === value ? "selected" : ""}`}><input type="radio" name="room-output" value={value} checked={preferences.receive === value} disabled={value === "speech" && !canSpeak} onChange={() => setReceive(value)} />{label}</label>)}</div><Switch checked={preferences.signVideos} onChange={(signVideos) => updatePreferences({ signVideos })}>Show saved sign videos</Switch></fieldset>
      <LanguageSelect value={preferences.lang} onChange={(lang) => updatePreferences({ lang })} id="room-language" label="Speech and text language" />
      <label className="field">Sign language<select value={preferences.signLanguage} onChange={(event) => updatePreferences({ signLanguage: event.target.value })}><option value="isl">Indian Sign Language (ISL)</option><option value="asl">American Sign Language (ASL)</option></select></label></div>
      <p className="fine-print">Text stays visible. Read aloud and screen-reader announcements are separate choices. Live sign video appears when your partner enables their camera.</p>
      <div className="room-speech-tools"><p className="fine-print">Read aloud plays on this device. Your receive choice controls partner messages; use Speak reviewed word or Read my draft aloud for your own signs.</p>{canSpeak ? <div className="actions"><button className="btn btn-small" type="button" disabled={capturing || speaking} onClick={() => void readMessage({ text: "SignBridge voice is ready.", lang: "en" })}>Test voice</button>{speaking && <button className="btn btn-small" type="button" onClick={stopSpeech}>Stop voice playback</button>}</div> : <p className="room-notice">Read aloud is unavailable in this browser. Use a browser with speech synthesis, or keep communicating with text.</p>}</div>
    </details>
    {!activeRoom && <section className="room-entry" aria-label="Start or join a conversation"><div><p className="eyebrow">01 · Connect</p><h3>{room.status === "ended" ? "Start a fresh conversation" : "Bring your partner in"}</h3><p>Create an invite, or open the link your partner shares. Your camera and microphone start only when you choose.</p></div><div className="room-entry-controls"><div className="room-choice-row"><button className={`btn ${entryAction === "create" ? "btn-primary" : ""}`} type="button" onClick={() => setEntryAction("create")}>Start conversation</button><button className={`btn ${entryAction === "join" ? "btn-primary" : ""}`} type="button" onClick={() => setEntryAction("join")}>Join conversation</button></div>{entryAction === "create" ? <button className="btn btn-primary" type="button" disabled={busyEntry} onClick={create}>{busyEntry ? "Connecting…" : "Create invite link"}</button> : <form onSubmit={join}><label className="field">Partner’s invite link<input type="text" value={invite} maxLength={2048} onChange={(event) => setInvite(event.target.value)} placeholder="Paste the invite link" autoComplete="off" /></label><button className="btn btn-primary" disabled={busyEntry || !invite.trim()}>{busyEntry ? "Joining…" : "Join room"}</button></form>}</div></section>}
    {activeRoom && <><section className="room-invite-strip" aria-label="Room invitation"><div><strong>{peerOnline ? "Your partner is here" : "Waiting for your partner"}</strong><p className="fine-print">Two people in this conversation. Share the invite privately.</p></div>{room.role === "host" && room.inviteUrl && <div className="room-invite-copy"><label className="sr-only" htmlFor="room-invite-link">Your invite link</label><input id="room-invite-link" value={room.inviteUrl} readOnly onFocus={(event) => event.target.select()} /><button className="btn btn-small" type="button" onClick={copyInvite}>{copied ? "Copied" : "Copy invite"}</button></div>}<button className="btn btn-ghost btn-small" type="button" onClick={leave}>Leave room</button>{room.role === "host" && <button className="btn btn-danger btn-small" type="button" disabled={room.status !== "connected"} onClick={() => { stopListening(); stopSpeech(); resetAI(); media.stop(); room.end(); }}>End for both</button>}</section>
      {room.status === "reconnecting" && <p className="fine-print">Reconnect to end the conversation for both people. Leaving now exits this device and releases its camera and microphone.</p>}<div className="room-layout"><section className="room-call" aria-label="Live conversation"><div className="room-panel-heading"><h3>See your partner</h3><span>{media.mediaStatus === "connected" ? "Video link connected" : peerOnline ? media.mediaStatus : "Waiting for partner"}</span></div><div className="room-video-stage"><video ref={media.remoteVideoRef} autoPlay playsInline muted={!media.remoteAudioEnabled || listening || speaking || preferences.receive !== "text"} aria-label="Partner’s live video" />{!media.remoteVideoOn && <div className="room-video-placeholder"><span aria-hidden="true">↔</span><strong>{peerOnline ? "Your partner can turn on their camera" : "A space for your partner"}</strong><p>Live signing works directly between people, without a recognition model.</p></div>}<div className="room-self-view"><video ref={media.localVideoRef} autoPlay playsInline muted className="mirror" aria-label="Your camera preview" />{media.cameraStatus !== "on" && <span>{media.cameraStatus === "starting" ? "Starting…" : "Camera off"}</span>}</div></div>
      <div className="room-media-controls"><button className={`btn ${media.cameraOn ? "" : "btn-primary"}`} type="button" disabled={media.cameraStatus === "starting"} onClick={() => { stopListening(); media.cameraOn ? media.disableCamera() : media.enableCamera(); }}>{media.cameraOn ? "Turn camera off" : "Turn camera on"}</button><button className="btn" type="button" onClick={() => { stopListening(); stopSpeech(); media.micOn || media.micStatus === "starting" ? media.disableMic() : media.enableMic(); }}>{media.micStatus === "starting" ? "Cancel microphone start" : media.micOn ? "Mute microphone" : "Turn microphone on"}</button><button className="btn btn-ghost" type="button" onClick={media.retry}>Reconnect video</button></div>
      {media.micStatus === "starting" && <p className="room-notice" role="status">Waiting for microphone access. Respond to the browser permission prompt, or cancel.</p>}
      <Switch checked={media.remoteAudioEnabled} disabled={preferences.receive !== "text"} onChange={(enabled) => { stopListening(); stopSpeech(); media.setRemoteAudioEnabled(enabled && preferences.receive === "text"); }} description="Choose Text output to listen to live audio. Captions can be sent as reviewed speech messages.">Listen to partner audio</Switch>
      {preferences.receive !== "text" && <p className="hint">Live audio is muted while your chosen read-aloud or screen-reader output is active.</p>}
      {media.error && <p className="room-notice error" role="alert">{media.error}</p>}{media.notice && <p className="room-notice">{media.notice}</p>}
      {media.playbackBlocked && <div className="room-notice"><p role="status">{media.playbackError}</p><button type="button" className="btn btn-small" onClick={media.retryRemotePlayback}>Play partner video/audio</button></div>}
      <details className="room-network-options"><summary>Video connection options</summary><Switch checked={media.forceRelay} onChange={media.setForceRelay} description="For network testing. Requires configured free TURN credentials; text chat remains available.">Require video relay</Switch><button type="button" className="btn btn-small" disabled={media.mediaStatus !== "connected" || media.routeStatus === "checking"} onClick={media.checkVideoRoute}>Check video route</button><p className="fine-print" role="status">{{ checking: "Checking the current video route…", relay: "Relay is in use for the selected media connection.", direct: "Direct media connection; relay is not in use.", mixed: "Selected media connections use both relay and direct routes.", unknown: "Video route is not available yet. Connect, then check again." }[media.routeStatus || "unknown"]}</p><p className="fine-print">This checks the current connection route. It does not test video quality or sign recognition.</p></details>
      </section><section className="room-messages" aria-label="Conversation history"><div className="room-panel-heading"><h3>Your conversation</h3><span>{messages.length} messages</span>{messages.length > 0 && <button className="room-inline-button" type="button" onClick={showLatest}>Jump to latest</button>}</div><div ref={chatList} className="room-message-list" aria-live="off" tabIndex={0} aria-label="Messages, newest last" onScroll={(event) => { const list = event.currentTarget; followConversation.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; }}>{!messages.length && <div className="room-empty-chat"><strong>Start with a message.</strong><p>Your partner’s messages appear here. Everyone chooses their own input and output.</p></div>}{messages.map((message) => <RoomMessage key={message.id} {...{ message, messages, connected }} clarifications={workflow.clarifications} participantId={room.participantId} sendAction={room.sendAction} lang={preferences.lang} onCompose={composeRelated} onRead={readMessage} />)}</div>
      <form className="room-composer" onSubmit={send}>{draft.relation && <div className="room-draft-context"><strong>{draft.relation.kind === "correction" ? "Correction to your message" : "Answer to a clarification"}</strong><p>{draftTarget?.text || "Earlier message"}</p><p className="fine-print">Your existing draft is kept. Review its wording before sending this linked message.</p><button className="room-inline-button" type="button" onClick={() => { const { relation: _relation, ...ordinary } = draft; editDraft(ordinary, false); }}>Send as an ordinary message instead</button></div>}<label htmlFor="room-draft">Your reviewed message</label><textarea id="room-draft" value={draft.text} maxLength={2000} rows={3} onChange={(event) => editDraft({ ...draft, text: event.target.value, lang: draft.text ? draft.lang : preferences.lang, inputMethod: draft.text && event.target.value ? draft.inputMethod : "text" })} placeholder="Type here, dictate a turn, or add a reviewed sign…" />{workflow.references?.length > 0 && <details className="room-draft-references"><summary>Attach shared references <span className="fine-print">{draft.referenceIds?.length || 0}/3</span></summary><p className="fine-print">Current labels and descriptions are saved with the message.</p>{workflow.references.map((reference) => <label className="room-reference-choice" key={reference.id}><input type="checkbox" checked={draft.referenceIds?.includes(reference.id) || false} disabled={!draft.referenceIds?.includes(reference.id) && draft.referenceIds?.length >= 3} onChange={(event) => editDraft({ ...draft, roomId: room.roomId, referenceIds: event.target.checked ? [...(draft.referenceIds || []), reference.id] : draft.referenceIds.filter((id) => id !== reference.id) }, false)} /><span><strong>{reference.label}</strong><span>{reference.description}</span></span></label>)}</details>}<div className="room-composer-meta"><span>{draft.text.length}/2,000 · {sourceLabel[draft.inputMethod]} · {language(draft.lang).name}</span><button className="room-inline-button" type="button" disabled={!undo.current.length || sending} onClick={() => { const previous = undo.current.pop(); if (previous) editDraft(previous, false); }}>Undo</button></div><div className="actions"><button className="btn btn-primary" disabled={room.status !== "connected" || !draft.text.trim() || sending || listening || capturing}>{sending ? "Sending…" : retryMessage.current ? "Retry reviewed message" : "Send to partner"}</button>{canSpeak && <button className="btn" type="button" disabled={!draft.text.trim() || capturing || speaking} onClick={() => void readMessage({ text: draft.text, lang: draft.lang })}>Read my draft aloud</button>}{(listening || speaking) && <button className="btn" type="button" onClick={() => { stopListening(); stopSpeech(); }}>Stop listening / speech</button>}</div></form>
      {preferences.inputMethod === "speech" && <div className="room-input-assist"><h4>Dictate a turn, then review</h4>{canListen ? <><div className="actions"><button className="btn" type="button" disabled={listening || capturing} onClick={dictate}>Start dictation</button>{listening && <><button className="btn" type="button" onClick={() => mic.current?.stop()}>Finish dictation</button><button className="btn btn-ghost" type="button" onClick={stopListening}>Cancel dictation</button></>}</div><p role="status">{listening ? interim || "Listening…" : "Speech is added to the draft; you choose when to send."}</p><p className="fine-print">Your browser’s speech recognition may use its online service. Partner audio is muted during dictation.</p></> : <p>Dictation is unavailable in this browser. Type your message or use live audio.</p>}</div>}
      {preferences.inputMethod === "sign" && <div className="room-input-assist"><h4>Sign directly, or compose reviewed words</h4><p className="hint">Turn on the camera for your partner to see natural signing. Enable hand-joint tracking below to see your wrist and finger joints on this device. ISL and ASL are separate languages; video does not translate between them.</p>{!recognition && <p className="room-notice" role="status">Word recognition is off. Enable hand-joint tracking below, then capture one complete supported word when its model is available.</p>}<Switch checked={recognition} onChange={(enabled) => { stopSpeech(); setRecognition(enabled); }}>Enable hand-joint tracking and word recognition</Switch>{recognition && <RoomSignCapture videoRef={media.localVideoRef} cameraStatus={media.cameraStatus} signLanguage={preferences.signLanguage} onAppend={append} onActivityChange={captureActivity} onRead={readMessage} canRead={canSpeak} speaking={speaking} onStopReading={stopSpeech} />}</div>}
      </section></div>
      <div className="room-workflow-layout"><MeetingSection key={`meetings:${room.roomId}`} cards={workflow.cards || []} participantId={room.participantId} {...{ connected }} sendAction={room.sendAction} lang={preferences.lang} onRead={readMessage} showSignVideos={preferences.signVideos} clips={videos.clips} signLanguage={preferences.signLanguage} /><ReferencesSection key={`references:${room.roomId}`} references={workflow.references || []} {...{ connected }} sendAction={room.sendAction} lang={preferences.lang} onRead={readMessage} /></div>
      {(room.pendingActions || []).some((entry) => entry.delivery === "uncertain") && <section className="room-notice" aria-label="Unconfirmed conversation actions"><h4>Actions awaiting confirmation</h4><p>Your draft and original action are kept. Reconnect, then choose whether to retry.</p>{room.pendingActions.filter((entry) => entry.delivery === "uncertain").map((entry) => { const currentCard = workflow.cards?.find((card) => card.id === entry.action.cardId); const oldApproval = entry.action.kind === "meeting.approve" && currentCard?.revision !== entry.action.revision; return <div key={entry.id}><p>{entry.action.kind.replaceAll(".", " ")}{entry.action.revision ? ` · reviewed revision ${entry.action.revision}` : ""}: {entry.error || "Confirmation uncertain"}</p>{oldApproval ? <p className="fine-print">Meeting details changed. Review the current revision above; this older approval will not be retried.</p> : <button className="btn btn-small" type="button" disabled={!connected} onClick={() => void room.sendAction(entry.action)}>Retry original action</button>}</div>; })}</section>}
      {preferences.signVideos && lastReceived && <SignVideoPlayer key={`${lastReceived.id}:${preferences.signLanguage}`} text={lastReceived.text} clips={videos.clips} signLanguage={preferences.signLanguage} textLanguage={lastReceived.lang} />}
      {preferences.signVideos && <p className="fine-print">Saved videos belong to this browser’s library; they are not automatically shared with another device. Missing coverage stays visible as text.</p>}
      <details className="room-ai-helper"><summary>Optional AI help</summary><p>Send only your current draft to the configured AI provider. Its suggestion stays here until you choose to use and send it.</p><div className="actions"><button className="btn" type="button" disabled={!draft.text.trim() || ai.busy || room.status !== "connected"} onClick={askAI}>{ai.busy ? "Asking…" : "Ask AI about this draft"}</button>{ai.busy && <button className="btn btn-ghost" type="button" onClick={() => { aiAbort.current?.abort(); setAI({ busy: false, reply: "", error: "" }); }}>Cancel AI help</button>}</div>{ai.reply && <div><p>{ai.reply}</p><button className="btn btn-small" type="button" onClick={() => editDraft({ ...draft, text: ai.reply, lang: draft.lang, inputMethod: "text" })}>Use suggestion as my draft</button></div>}{ai.error && <p className="error" role="alert">{ai.error}</p>}</details>
    </>}
    {speechStatus && <p className="room-speech-status" role="status">{speechStatus}</p>}
    <div className="sr-only" role="status" aria-live={preferences.receive === "screenreader" ? "polite" : "off"} aria-atomic="true"><span key={announcement}>{preferences.receive === "screenreader" ? liveText : ""}</span></div>
    {(localError || room.error) && <p className="room-notice error" role="alert">{localError || room.error}</p>}{room.notice && <p className="room-notice">{room.notice}</p>}
    {["reconnecting", "error"].includes(room.status) && <button className="btn" type="button" onClick={room.retry}>Retry connection</button>}
    {videos.error && preferences.signVideos && <p className="room-notice error">{videos.error}</p>}
    <footer className="room-footer"><p>Camera and microphone sharing are controlled by you. Calls are not recorded by SignBridge. Room text is held temporarily in server memory; your draft stays in this browser tab.</p><details><summary>Tools</summary><div className="actions">{[["trained-sign", "Local Sign Workspace"], ["voice", "AI voice assistant"], ["training-studio", "Training Studio"], ["sign-videos", "Saved sign videos"]].map(([mode, title]) => <button key={mode} className="btn btn-ghost btn-small" type="button" onClick={() => { if (activeRoom) leave(); onTool(mode); }}>{title}</button>)}</div><p className="fine-print">Opening a tool leaves this room and stops its media. Your message draft is retained.</p></details></footer>
  </main>;
}
