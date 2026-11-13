import { useEffect } from "react";
import BridgeScene from "../components/BridgeScene.jsx";
import HalftoneField from "../components/HalftoneField.jsx";
import ThemeSwitch from "../components/ThemeSwitch.jsx";
import { TiltedCard, ReactBitsDock } from "../components/reactbits/ReactBitsUI.jsx";
import "../styles/connect.css";

function HomeIcon({ kind, className = "" }) {
  return <svg className={className} width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === "bridge" ? <><path d="M3 21h22M6 21V8m16 13V8M6 11c4 8 12 8 16 0M10 16v5m8-5v5" /><circle cx="6" cy="6" r="1" /><circle cx="22" cy="6" r="1" /></>
      : kind === "join" ? <path d="M11 6h11v16H11M4 14h12m-4-4 4 4-4 4" />
      : kind === "start" ? <><path d="M5 18v4h4M19 6h4v4M23 6l-7 7M5 22l7-7" /><path d="M7 6h6M7 6v6M21 22h-6m6 0v-6" /></>
      : kind === "sign" ? <><path d="M9 23c-3-3-4-5-4-8a2 2 0 0 1 4 0v-5a2 2 0 0 1 4 0v4-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v8c0 3-1 5-3 7" /><path d="M10 19c0-3 2-5 5-5" /></>
      : kind === "ai" ? <><path d="m14 3 2.5 7.5L24 13l-7.5 2.5L14 23l-2.5-7.5L4 13l7.5-2.5L14 3Z" /><path d="m23 21 .6 1.4L25 23l-1.4.6L23 25l-.6-1.4L21 23l1.4-.6L23 21Z" /></>
      : <><rect x="10" y="3" width="8" height="14" rx="4" /><path d="M6 12v2a8 8 0 0 0 16 0v-2M14 22v3m-4 0h8" /></>}
  </svg>;
}

export default function Home({ onPick, shell }) {
  useEffect(() => { document.title = "SignBridge — connect your way"; }, []);
  const join = () => { onPick("connect"); window.history.replaceState(null, "", "#connect?action=join"); };
  const signWithAI = () => { onPick("trained-sign"); window.history.replaceState(null, "", "#trained-sign?with=ai"); };
  return <main className="home connect-home rb-theme ht-enter" aria-labelledby="home-title">
    <header className="home-masthead">
      <div className="home-wordmark"><span className="home-brand-mark"><HomeIcon kind="bridge" /></span><span>SignBridge<span className="home-wordmark-dot" aria-hidden="true">.</span></span></div>
      <p className="home-masthead-note">A shared space for conversation</p>
      <ThemeSwitch />
      {shell?.canInstall && <button className="btn btn-ghost btn-small" type="button" onClick={shell.install}>Install SignBridge</button>}
    </header>
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero-copy ht-print">
        <p className="eyebrow home-hero-eyebrow"><span aria-hidden="true" />Signs · Text · Voice</p>
        <h1 id="home-title">Connect<br /><em className="ht-misreg" data-text="your way.">your way.</em></h1>
        <p className="lede">Understand each other through signs, text and voice. Choose how you send a message and how you receive your partner’s reply.</p>
        <div className="home-hero-footnote"><span className="home-hero-rule" aria-hidden="true" /><p>Different ways to communicate.<br />One place to meet.</p></div>
      </div>
      <div className="home-hero-art ht-marks" aria-hidden="true">
        <HalftoneField pattern="sun" cell={11} interactive />
        <BridgeScene />
        <span className="home-art-label home-art-label-top">The space between us</span>
        <span className="home-art-label home-art-label-bottom">A little closer.</span>
      </div>
    </section>
    <section className="home-conversation" aria-labelledby="home-conversation-title">
      <div className="home-section-heading"><div><p className="eyebrow"><span className="dot-num">01</span>Together</p><h2 id="home-conversation-title">Talk to someone</h2></div><p className="home-section-aside">Start here for a conversation with your partner.</p></div>
      <div className="mode-cards">
        <TiltedCard as="button" maxTilt={7} className="mode-card mode-sign home-conversation-card ht-shadow" type="button" onClick={() => onPick("connect")}>
          <span className="mode-icon" aria-hidden="true"><HomeIcon kind="start" /></span>
          <span className="mode-title">Start conversation</span>
          <span className="mode-desc">Create an invite and share it with your partner.</span>
          <span className="home-card-arrow" aria-hidden="true">↗</span>
        </TiltedCard>
        <TiltedCard as="button" maxTilt={7} className="mode-card mode-voice home-conversation-card ht-shadow" type="button" onClick={join}>
          <span className="mode-icon" aria-hidden="true"><HomeIcon kind="join" /></span>
          <span className="mode-title">Join conversation</span>
          <span className="mode-desc">Use your partner’s invite to join from a phone or laptop.</span>
          <span className="home-card-arrow" aria-hidden="true">↗</span>
        </TiltedCard>
      </div>
      <div className="home-conversation-bottom"><p className="fine-print">Review a recognized sign, then send its text. Your partner can read and hear it, and reply by typing or speaking. Matching saved videos can show the reply in signs; unsupported signs and phrases need another way to communicate.</p><button className="btn btn-ghost" type="button" onClick={() => onPick("connect")}>Communication preferences</button></div>
    </section>
    <section className="home-quick-tools" aria-labelledby="home-quick-tools-title">
      <div className="home-section-heading"><div><p className="eyebrow"><span className="dot-num">02</span>Explore</p><h2 id="home-quick-tools-title">Quick tools</h2></div><p className="home-section-aside">Use a tool at your own pace.</p></div>
      <div className="home-quick-grid">
        <TiltedCard as="button" maxTilt={8} className="home-quick-tool ht-shadow" type="button" onClick={() => onPick("trained-sign")}>
          <HomeIcon kind="sign" className="home-tool-icon" />
          <span className="home-quick-title">Sign to text &amp; voice <span aria-hidden="true">↗</span></span>
          <span className="mode-desc">Use your camera to capture one sign. Review the text and read it aloud.</span>
          <span className="home-tool-note">Experimental isolated words. Translation is not validated. Review every result.</span>
        </TiltedCard>
        <TiltedCard as="button" maxTilt={8} className="home-quick-tool ht-shadow" type="button" onClick={signWithAI}>
          <HomeIcon kind="ai" className="home-tool-icon" />
          <span className="home-quick-title">Talk to AI with signs <span aria-hidden="true">↗</span></span>
          <span className="mode-desc">Capture a supported word or type, review your message, then ask the AI assistant for a reply.</span>
          <span className="home-tool-note">Experimental word recognition. AI receives your reviewed text only when you send it.</span>
        </TiltedCard>
        <TiltedCard as="button" maxTilt={8} className="home-quick-tool ht-shadow" type="button" onClick={() => onPick("voice")}>
          <HomeIcon kind="voice" className="home-tool-icon" />
          <span className="home-quick-title">Speak with AI <span aria-hidden="true">↗</span></span>
          <span className="mode-desc">Speak to the AI assistant and hear its reply.</span>
        </TiltedCard>
      </div>
      <p className="shortcut-tip">Keyboard: <kbd>S</kbd> opens Sign to text &amp; voice. <kbd>V</kbd> opens Speak with AI.</p>
    </section>
    <ul className="facts home-principles">
      <li><span className="home-principle-mark" aria-hidden="true">01</span><div><strong>Choose your output.</strong><p>Text, text + voice, saved sign video or screen reader. Change preferences while you talk.</p></div></li>
      <li><span className="home-principle-mark" aria-hidden="true">02</span><div><strong>Sign with your partner.</strong><p>Share live camera video for ISL or ASL conversations.</p></div></li>
      <li><span className="home-principle-mark" aria-hidden="true">03</span><div><strong>You control sharing.</strong><p>Camera and microphone start when you choose. AI help is optional.</p></div></li>
    </ul>
    <details className="home-tools"><summary>More tools</summary><div className="actions">{[["training-studio", "Training Studio"], ["sign-videos", "Saved sign videos"], ["live-sign", "Experimental video practice"], ["wlasl", "ASL video model"]].map(([mode, title]) => <button key={mode} className="btn btn-ghost btn-small" type="button" onClick={() => onPick(mode)}>{title}</button>)}</div><p className="fine-print">Practice, record your own examples or play saved sign videos.</p></details>
    {shell?.iosHint && <p className="shortcut-tip">Install on iPhone or iPad: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>}
    <footer className="home-footer"><span>SignBridge</span><p>Communication, on your terms.</p></footer>
    {import.meta.env?.MODE !== "test" && (
      <ReactBitsDock
        items={[
          { id: "sign", icon: "🤟", label: "Sign to Text & Voice", onClick: () => onPick("trained-sign") },
          { id: "ai-sign", icon: "✨", label: "Talk to AI with Signs", onClick: signWithAI },
          { id: "connect", icon: "🤝", label: "Start Partner Room", onClick: () => onPick("connect") },
          { id: "join", icon: "🔗", label: "Join Room", onClick: join },
          { id: "voice", icon: "🎙️", label: "Speak with AI", onClick: () => onPick("voice") },
          { id: "wlasl", icon: "🎬", label: "WLASL Video Model", onClick: () => onPick("wlasl") },
        ]}
      />
    )}
  </main>;
}
