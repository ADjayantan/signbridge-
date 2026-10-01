import { useEffect } from "react";
import { LanguageSelect } from "../components/Controls.jsx";

export default function Home({ settings, update, onPick, shell }) {
  useEffect(() => {
    document.title = "SignBridge — talk to AI in sign language or by voice";
  }, []);

  return (
    <main className="home" aria-labelledby="home-title">
      <header className="brand">
        <span className="logo" aria-hidden="true">
          🤟
        </span>
        <div>
          <p className="eyebrow">SignBridge</p>
          <h1 id="home-title">Talk to AI your way</h1>
        </div>
      </header>
      <p className="lede">Sign to the camera, or speak out loud. SignBridge answers in clear text or in speech.</p>

      <div className="mode-cards">
        <button type="button" className="mode-card mode-sign" onClick={() => onPick("sign")} aria-describedby="sign-desc">
          <span className="mode-icon" aria-hidden="true">
            🤟
          </span>
          <span className="mode-title">
            Sign mode <kbd>S</kbd>
          </span>
          <span id="sign-desc" className="mode-desc">
            For Deaf and hard-of-hearing people. Sign to the camera and read the answer.
          </span>
        </button>
        <button type="button" className="mode-card mode-voice" onClick={() => onPick("voice")} aria-describedby="voice-desc">
          <span className="mode-icon" aria-hidden="true">
            🎙️
          </span>
          <span className="mode-title">
            Voice mode <kbd>V</kbd>
          </span>
          <span id="voice-desc" className="mode-desc">
            For blind and low-vision people. Speak, hear the answer, and keep talking hands-free.
          </span>
        </button>
      </div>
      <p className="shortcut-tip">
        Keyboard: press <kbd>V</kbd> for voice mode or <kbd>S</kbd> for sign mode.
      </p>

      <div className="home-settings">
        <LanguageSelect value={settings.lang} onChange={(lang) => update({ lang })} id="home-language" />
        {shell?.canInstall && (
          <button type="button" className="btn btn-primary install-button" onClick={shell.install}>
            <span aria-hidden="true">⬇</span> Install the SignBridge app
          </button>
        )}
      </div>
      {shell?.iosHint && (
        <p className="shortcut-tip">
          Install on iPhone or iPad: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </p>
      )}

      <ul className="facts">
        <li>
          <strong>Private hand tracking.</strong> Your camera video is processed on this device and never uploaded.
        </li>
        <li>
          <strong>Your own signs.</strong> Teach Indian Sign Language signs in a few seconds each.
        </li>
        <li>
          <strong>Six languages.</strong> English, Tamil, Hindi, Malayalam, Telugu and Kannada.
        </li>
      </ul>
    </main>
  );
}
