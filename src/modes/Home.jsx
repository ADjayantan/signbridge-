import { useEffect } from "react";
import "../styles/connect.css";

export default function Home({ onPick, shell }) {
  useEffect(() => { document.title = "SignBridge — connect your way"; }, []);
  const join = () => { onPick("connect"); window.history.replaceState(null, "", "#connect?action=join"); };
  const signWithAI = () => { onPick("trained-sign"); window.history.replaceState(null, "", "#trained-sign?with=ai"); };
  return <main className="home connect-home" aria-labelledby="home-title">
    <header className="brand"><span className="logo" aria-hidden="true">↔</span><div><p className="eyebrow">SignBridge</p><h1 id="home-title">Connect your way.</h1></div></header>
    <p className="lede">Understand each other through signs, text and voice. Choose how you send a message and how you receive your partner’s reply.</p>
    <section className="home-conversation" aria-labelledby="home-conversation-title">
      <h2 id="home-conversation-title">Talk to someone</h2>
      <p className="fine-print">Review a recognized sign, then send its text. Your partner can read and hear it, and reply by typing or speaking. Matching saved videos can show the reply in signs; unsupported signs and phrases need another way to communicate.</p>
      <div className="mode-cards">
        <button className="mode-card mode-sign" type="button" onClick={() => onPick("connect")}>
          <span className="mode-icon" aria-hidden="true">↗</span>
          <span className="mode-title">Start conversation</span>
          <span className="mode-desc">Create an invite and share it with your partner.</span>
        </button>
        <button className="mode-card mode-voice" type="button" onClick={join}>
          <span className="mode-icon" aria-hidden="true">↙</span>
          <span className="mode-title">Join conversation</span>
          <span className="mode-desc">Use your partner’s invite to join from a phone or laptop.</span>
        </button>
      </div>
      <div className="actions"><button className="btn" type="button" onClick={() => onPick("connect")}>Communication preferences</button>{shell?.canInstall && <button className="btn btn-ghost" type="button" onClick={shell.install}>Install SignBridge</button>}</div>
    </section>
    <section className="home-quick-tools" aria-labelledby="home-quick-tools-title">
      <h2 id="home-quick-tools-title">Quick tools</h2>
      <div className="home-quick-grid">
        <button className="home-quick-tool" type="button" onClick={() => onPick("trained-sign")}>
          <span className="home-quick-title">Sign to text &amp; voice <span aria-hidden="true">→</span></span>
          <span className="mode-desc">Use your camera to capture one sign. Review the text and read it aloud.</span>
          <span className="home-tool-note">Experimental isolated words. Translation is not validated. Review every result.</span>
        </button>
        <button className="home-quick-tool" type="button" onClick={signWithAI}>
          <span className="home-quick-title">Talk to AI with signs <span aria-hidden="true">→</span></span>
          <span className="mode-desc">Capture a supported word or type, review your message, then ask the AI assistant for a reply.</span>
          <span className="home-tool-note">Experimental word recognition. AI receives your reviewed text only when you send it.</span>
        </button>
        <button className="home-quick-tool" type="button" onClick={() => onPick("voice")}>
          <span className="home-quick-title">Speak with AI <span aria-hidden="true">→</span></span>
          <span className="mode-desc">Speak to the AI assistant and hear its reply.</span>
        </button>
      </div>
      <p className="shortcut-tip">Keyboard: <kbd>S</kbd> opens Sign to text &amp; voice. <kbd>V</kbd> opens Speak with AI.</p>
    </section>
    <ul className="facts"><li><strong>Choose your output.</strong> Text, text + voice, saved sign video or screen reader. Change preferences while you talk.</li><li><strong>Sign with your partner.</strong> Share live camera video for ISL or ASL conversations.</li><li><strong>You control sharing.</strong> Camera and microphone start when you choose. AI help is optional.</li></ul>
    <details className="home-tools"><summary>More tools</summary><div className="actions">{[["training-studio", "Training Studio"], ["sign-videos", "Saved sign videos"], ["live-sign", "Experimental video practice"]].map(([mode, title]) => <button key={mode} className="btn btn-ghost btn-small" type="button" onClick={() => onPick(mode)}>{title}</button>)}</div><p className="fine-print">Practice, record your own examples or play saved sign videos.</p></details>
    {shell?.iosHint && <p className="shortcut-tip">Install on iPhone or iPad: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>}
  </main>;
}
