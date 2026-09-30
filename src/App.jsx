import { useState, useEffect, useRef } from "react";

const CONTACTS = [
  { id: 1, name: "Priya Sharma", avatar: "PS", status: "online", lastMsg: "See you at 5pm!", time: "2m", unread: 2, lang: "Tamil" },
  { id: 2, name: "Ravi Kumar", avatar: "RK", status: "online", lastMsg: "👋 Thanks for the call", time: "14m", unread: 0, lang: "Hindi" },
  { id: 3, name: "Aisha Nair", avatar: "AN", status: "away", lastMsg: "Can we do a video call?", time: "1h", unread: 1, lang: "Malayalam" },
  { id: 4, name: "James Chen", avatar: "JC", status: "offline", lastMsg: "Great talking!", time: "3h", unread: 0, lang: "English" },
  { id: 5, name: "Fatima Al-Sayed", avatar: "FA", status: "online", lastMsg: "🤟 Love you!", time: "5h", unread: 0, lang: "Arabic" },
];

const SIGN_TRANSLATIONS = {
  Tamil: [
    { sign: "🤟", text: "வணக்கம்! நீங்கள் எப்படி இருக்கிறீர்கள்?" },
    { sign: "👋", text: "நான் நலமாக இருக்கிறேன், நன்றி!" },
    { sign: "✌️", text: "நாளை சந்திப்போம், சரியா?" },
    { sign: "🖐️", text: "இது மிகவும் நல்லதாக இருக்கிறது!" },
    { sign: "👌", text: "ஆமாம், நான் புரிந்துகொண்டேன்." },
    { sign: "🤙", text: "உங்களுடன் பேசுவது மகிழ்ச்சியாக உள்ளது." },
    { sign: "🤏", text: "கொஞ்சம் நேரம் இருக்கிறீர்களா?" },
  ],
  Hindi: [
    { sign: "🤟", text: "नमस्ते! आप कैसे हैं?" },
    { sign: "👋", text: "मैं बिल्कुल ठीक हूँ, धन्यवाद!" },
    { sign: "✌️", text: "कल मिलते हैं, ठीक है?" },
    { sign: "🖐️", text: "यह बहुत अच्छा है!" },
    { sign: "👌", text: "हाँ, मैं समझ गया।" },
    { sign: "🤙", text: "आपसे बात करके अच्छा लगा।" },
    { sign: "🤏", text: "क्या आपके पास थोड़ा समय है?" },
  ],
  Malayalam: [
    { sign: "🤟", text: "നമസ്കാരം! സുഖമാണോ?" },
    { sign: "👋", text: "ഞാൻ നന്നായിരിക്കുന്നു, നന്ദി!" },
    { sign: "✌️", text: "നാളെ കാണാം, ശരിയോ?" },
    { sign: "🖐️", text: "ഇത് വളരെ നല്ലതാണ്!" },
    { sign: "👌", text: "ഉം, എനിക്ക് മനസ്സിലായി." },
    { sign: "🤙", text: "നിങ്ങളുമായി സംസാരിക്കുന്നത് ആനന്ദമാണ്." },
    { sign: "🤏", text: "നിങ്ങൾക്ക് കുറച്ച് സമയമുണ്ടോ?" },
  ],
  English: [
    { sign: "🤟", text: "Hello! How are you doing?" },
    { sign: "👋", text: "I'm doing really well, thank you!" },
    { sign: "✌️", text: "See you tomorrow, okay?" },
    { sign: "🖐️", text: "This is really great!" },
    { sign: "👌", text: "Yes, I understand now." },
    { sign: "🤙", text: "It's so nice talking with you." },
    { sign: "🤏", text: "Do you have a moment to talk?" },
  ],
  Arabic: [
    { sign: "🤟", text: "مرحبا! كيف حالك؟" },
    { sign: "👋", text: "أنا بخير تماماً، شكراً!" },
    { sign: "✌️", text: "أراك غداً، حسناً؟" },
    { sign: "🖐️", text: "هذا رائع جداً!" },
    { sign: "👌", text: "نعم، لقد فهمت الآن." },
    { sign: "🤙", text: "من الجميل التحدث معك." },
    { sign: "🤏", text: "هل لديك لحظة للحديث؟" },
  ],
};

const avatarColors = {
  PS: "#e25c8a",
  RK: "#5c9be2",
  AN: "#5ce2a8",
  JC: "#e2a85c",
  FA: "#a85ce2",
};

export default function App() {
  const [screen, setScreen] = useState("chat");
  const [activeContact, setActiveContact] = useState(null);

  const startCall = (contact) => {
    setActiveContact(contact);
    setScreen("call");
  };

  if (screen === "call") return <CallScreen contact={activeContact} onEnd={() => setScreen("chat")} />;
  return <ChatList contacts={CONTACTS} onCall={startCall} />;
}

function CallScreen({ contact, onEnd }) {
  const [callDuration, setCallDuration] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [caption, setCaption] = useState(null);
  const [handVisible, setHandVisible] = useState(false);
  const [handPos, setHandPos] = useState({ x: 52, y: 52 });
  const [scanning, setScanning] = useState(false);
  const [captionFade, setCaptionFade] = useState(false);
  const [particles, setParticles] = useState([]);
  const [scanProgress, setScanProgress] = useState(0);
  const idxRef = useRef(0);
  const captionTimer = useRef(null);
  const scanRef = useRef(null);

  const lang = contact?.lang || "English";
  const signs = SIGN_TRANSLATIONS[lang] || SIGN_TRANSLATIONS["English"];

  useEffect(() => {
    const t = setInterval(() => setCallDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setHandPos({ x: 28 + Math.random() * 44, y: 30 + Math.random() * 38 });
    }, 3200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const cycle = () => {
      setHandVisible(true);
      setScanning(true);
      setScanProgress(0);

      // Animate scan progress bar
      let p = 0;
      clearInterval(scanRef.current);
      scanRef.current = setInterval(() => {
        p += 8;
        setScanProgress(Math.min(p, 100));
        if (p >= 100) clearInterval(scanRef.current);
      }, 80);

      setTimeout(() => {
        setScanning(false);
        const item = signs[idxRef.current % signs.length];
        idxRef.current++;
        setCaptionFade(false);
        setCaption({ ...item, id: Date.now() });
        setParticles(Array.from({ length: 10 }, (_, i) => ({
          id: Date.now() + i,
          angle: (i / 10) * 360,
          speed: 0.6 + Math.random() * 0.4,
        })));
        setTimeout(() => setParticles([]), 900);

        clearTimeout(captionTimer.current);
        captionTimer.current = setTimeout(() => {
          setCaptionFade(true);
          setHandVisible(false);
          setTimeout(() => setCaption(null), 500);
        }, 3200);
      }, 1100);
    };

    const interval = setInterval(cycle, 5800);
    setTimeout(cycle, 400);
    return () => { clearInterval(interval); clearTimeout(captionTimer.current); clearInterval(scanRef.current); };
  }, [lang]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ width: "100%", maxWidth: 420, margin: "0 auto", height: "100vh", background: "#000", fontFamily: "'Sora',sans-serif", color: "#fff", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes floatHand { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-7px) scale(1.06)} }
        @keyframes ringExpand { 0%{transform:scale(0.7);opacity:0.9} 100%{transform:scale(2.2);opacity:0} }
        @keyframes captionIn { 0%{opacity:0;transform:translateY(18px) scale(0.96)} 100%{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes captionOut { 0%{opacity:1;transform:translateY(0) scale(1)} 100%{opacity:0;transform:translateY(-10px) scale(0.97)} }
        @keyframes burst { 0%{transform:rotate(var(--a)) translateX(4px);opacity:1} 100%{transform:rotate(var(--a)) translateX(45px);opacity:0} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .btn { transition:transform .14s,opacity .12s; cursor:pointer; border:none; }
        .btn:hover { transform:scale(1.1); }
        .btn:active { transform:scale(0.93); opacity:0.7; }
      `}</style>

      {/* ───── FULL SCREEN VIDEO ───── */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden", background: `linear-gradient(160deg, #0c1827 0%, #060f1d 55%, #0b1625 100%)` }}>

        {/* Ambient radial glow that follows hand */}
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 55% 45% at ${handPos.x}% ${handPos.y}%, ${avatarColors[contact.avatar]}1e 0%, transparent 72%)`, transition: "all 1.8s cubic-bezier(0.4,0,0.2,1)", pointerEvents: "none" }} />

        {/* Grid texture */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.018) 1px,transparent 1px)", backgroundSize: "44px 44px", pointerEvents: "none" }} />

        {/* Remote person */}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, userSelect: "none" }}>
            <div style={{ width: 96, height: 96, borderRadius: "50%", background: `linear-gradient(135deg,${avatarColors[contact.avatar]},${avatarColors[contact.avatar]}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 700, color: "#fff", boxShadow: `0 0 55px ${avatarColors[contact.avatar]}44`, border: `2px solid ${avatarColors[contact.avatar]}55` }}>
              {contact.avatar}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{contact.name}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", letterSpacing: 2, fontVariantNumeric: "tabular-nums" }}>{fmt(callDuration)}</div>
          </div>
        </div>

        {/* ── HAND SIGN DETECTION — seamlessly on video ── */}
        {handVisible && (
          <div style={{ position: "absolute", left: `${handPos.x}%`, top: `${handPos.y}%`, transform: "translate(-50%,-50%)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 8 }}>

            {/* Expanding scan rings */}
            {scanning && [0, 1, 2].map(i => (
              <div key={i} style={{ position: "absolute", width: 68, height: 68, borderRadius: "50%", border: "1.5px solid rgba(0,210,255,0.65)", animation: `ringExpand 1.1s ease-out ${i * 260}ms infinite` }} />
            ))}

            {/* Bounding box */}
            <div style={{
              position: "absolute", width: 76, height: 76,
              border: `2px solid ${scanning ? "rgba(0,210,255,0.7)" : "rgba(0,255,150,0.8)"}`,
              borderRadius: 12,
              boxShadow: scanning ? "0 0 16px rgba(0,210,255,0.35),inset 0 0 12px rgba(0,210,255,0.08)" : "0 0 22px rgba(0,255,150,0.4),inset 0 0 14px rgba(0,255,150,0.07)",
              transition: "border-color .4s,box-shadow .4s",
            }}>
              {["tl","tr","bl","br"].map(c => (
                <div key={c} style={{ position: "absolute", width: 14, height: 14, borderTop: c[0]==="t" ? `3px solid ${scanning?"#00d2ff":"#00ff96"}` : "none", borderBottom: c[0]==="b" ? `3px solid ${scanning?"#00d2ff":"#00ff96"}` : "none", borderLeft: c[1]==="l" ? `3px solid ${scanning?"#00d2ff":"#00ff96"}` : "none", borderRight: c[1]==="r" ? `3px solid ${scanning?"#00d2ff":"#00ff96"}` : "none", top: c[0]==="t" ? -2 : "auto", bottom: c[0]==="b" ? -2 : "auto", left: c[1]==="l" ? -2 : "auto", right: c[1]==="r" ? -2 : "auto" }} />
              ))}

              {/* Scan progress bar inside box */}
              {scanning && (
                <div style={{ position: "absolute", bottom: 0, left: 0, height: 2, width: `${scanProgress}%`, background: "linear-gradient(90deg,#00d2ff,#00ff96)", borderRadius: "0 0 10px 10px", transition: "width .08s linear" }} />
              )}
            </div>

            {/* The hand emoji */}
            <div style={{ fontSize: 34, zIndex: 2, filter: scanning ? "brightness(0.65) saturate(0.6)" : "brightness(1.1)", transition: "filter .4s", animation: "floatHand 2.2s ease-in-out infinite" }}>
              {caption?.sign || "🤟"}
            </div>

            {/* Burst on detect */}
            {particles.map(p => (
              <div key={p.id} style={{ position: "absolute", width: 5, height: 5, borderRadius: "50%", background: "#00ff96", "--a": `${p.angle}deg`, animation: `burst ${p.speed}s ease-out forwards`, transformOrigin: "center center" }} />
            ))}

            {/* Tiny "SIGN DETECTED" chip on box */}
            {!scanning && caption && (
              <div style={{ position: "absolute", top: -26, left: "50%", transform: "translateX(-50%)", background: "rgba(0,255,150,0.18)", border: "1px solid rgba(0,255,150,0.55)", borderRadius: 20, padding: "2px 10px", fontSize: 9, fontWeight: 700, color: "#00ff96", letterSpacing: 1.5, whiteSpace: "nowrap" }}>
                ✦ SIGN DETECTED
              </div>
            )}
          </div>
        )}

        {/* ── CAPTION — overlaid directly on video, bottom center ── */}
        {caption && (
          <div style={{ position: "absolute", bottom: 72, left: 12, right: 12, zIndex: 20, animation: captionFade ? "captionOut .5s ease forwards" : "captionIn .42s cubic-bezier(0.34,1.56,0.64,1) forwards", pointerEvents: "none" }}>
            <div style={{ background: "rgba(4,8,18,0.78)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", borderRadius: 20, padding: "13px 18px 14px", border: "1px solid rgba(0,255,150,0.22)", boxShadow: "0 10px 44px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)" }}>

              {/* Top strip: sign icon + lang badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{caption.sign}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff96", animation: "blink 1.1s ease-in-out infinite" }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: "#00ff96", letterSpacing: 2.2 }}>SIGN → {lang.toUpperCase()}</span>
                </div>
                {/* Shimmer bar */}
                <div style={{ width: 48, height: 3, borderRadius: 2, background: "linear-gradient(90deg,rgba(0,255,150,0.1) 0%,rgba(0,210,255,0.4) 50%,rgba(0,255,150,0.1) 100%)", backgroundSize: "200% 100%", animation: "shimmer 1.8s linear infinite" }} />
              </div>

              {/* Translated text */}
              <div style={{ fontSize: 17, lineHeight: 1.6, fontWeight: 500, color: "#fff", letterSpacing: 0.25 }}>
                {caption.text}
              </div>
            </div>
          </div>
        )}

        {/* ── TOP BAR ── */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "14px 14px 10px", background: "linear-gradient(to bottom,rgba(0,0,0,0.6),transparent)", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 15 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: `linear-gradient(135deg,${avatarColors[contact.avatar]},${avatarColors[contact.avatar]}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
              {contact.avatar}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{contact.name}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: 1 }}>HD · {fmt(callDuration)}</div>
            </div>
          </div>
          {/* Signal bars */}
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
            {[9,14,20,26].map((h,i) => (
              <div key={i} style={{ width: 4, height: h, borderRadius: 2, background: i < 3 ? "#00ff96" : "rgba(255,255,255,0.18)" }} />
            ))}
          </div>
        </div>

        {/* ── SELF VIEW ── */}
        <div style={{ position: "absolute", top: 66, right: 12, width: 80, height: 110, borderRadius: 16, overflow: "hidden", border: "2px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 22px rgba(0,0,0,0.55)", zIndex: 15 }}>
          <div style={{ width: "100%", height: "100%", background: "linear-gradient(160deg,#182840,#0c1a2e)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
            {camOn ? (
              <>
                <div style={{ fontSize: 26 }}>🧏</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.32)" }}>You</div>
              </>
            ) : (
              <div style={{ fontSize: 20, opacity: 0.25 }}>📷</div>
            )}
          </div>
        </div>
      </div>

      {/* ── CONTROLS ── */}
      <div style={{ background: "rgba(5,8,18,0.97)", backdropFilter: "blur(24px)", padding: "16px 32px 26px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.05)", zIndex: 20 }}>
        <button className="btn" onClick={() => setMicOn(m => !m)} style={{ width: 54, height: 54, borderRadius: "50%", background: micOn ? "rgba(255,255,255,0.09)" : "rgba(255,55,55,0.22)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <span style={{ fontSize: 23 }}>{micOn ? "🎙️" : "🔇"}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.38)" }}>{micOn ? "Mute" : "Unmute"}</span>
        </button>

        <button className="btn" onClick={onEnd} style={{ width: 68, height: 68, borderRadius: "50%", background: "linear-gradient(135deg,#ff3c3c,#be0000)", fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 28px rgba(255,50,50,0.42)" }}>
          📵
        </button>

        <button className="btn" onClick={() => setCamOn(c => !c)} style={{ width: 54, height: 54, borderRadius: "50%", background: camOn ? "rgba(255,255,255,0.09)" : "rgba(255,55,55,0.22)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <span style={{ fontSize: 23 }}>{camOn ? "📹" : "🚫"}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.38)" }}>{camOn ? "Camera" : "Off"}</span>
        </button>
      </div>
    </div>
  );
}

function ChatList({ contacts, onCall }) {
  const [search, setSearch] = useState("");
  const filtered = contacts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(160deg,#080d1a 0%,#060c18 100%)", fontFamily: "'Sora',sans-serif", color: "#e8f0fe", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .row { transition: background .18s, transform .18s; cursor: pointer; }
        .row:hover { background: rgba(0,255,150,0.04) !important; transform: translateX(3px); }
        .vcbtn { transition: all .18s; cursor: pointer; }
        .vcbtn:hover { background: rgba(0,255,150,0.2) !important; transform: scale(1.12); }
        input:focus { outline:none; border-color:rgba(0,210,255,0.45) !important; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1a2e4a; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "22px 16px 14px", background: "rgba(0,0,0,0.28)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3.5, color: "#00d2ff", marginBottom: 3 }}>SIGNBRIDGE</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Chats</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#00d2ff,#00ff96)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>🤟</div>
        </div>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.3 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "9px 12px 9px 36px", color: "#e8f0fe", fontFamily: "'Sora',sans-serif", fontSize: 14, transition: "border .2s" }} />
        </div>
      </div>

      {/* AI Strip */}
      <div style={{ margin: "12px 14px 4px", background: "linear-gradient(90deg,rgba(0,210,255,0.1),rgba(0,255,150,0.07))", border: "1px solid rgba(0,210,255,0.17)", borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22 }}>🧏</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#00d2ff" }}>Auto Sign Language Detection</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", marginTop: 2 }}>AI detects hand signs & shows native captions live on calls</div>
        </div>
        <div style={{ background: "rgba(0,255,150,0.16)", color: "#00ff96", fontSize: 9, fontWeight: 700, padding: "4px 8px", borderRadius: 20, letterSpacing: 1.5 }}>AI ON</div>
      </div>

      {/* Contact List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.map(c => (
          <div key={c.id} className="row" style={{ display: "flex", alignItems: "center", padding: "11px 14px", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: `linear-gradient(135deg,${avatarColors[c.avatar]},${avatarColors[c.avatar]}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>{c.avatar}</div>
              <div style={{ position: "absolute", bottom: 1, right: 1, width: 11, height: 11, borderRadius: "50%", background: c.status === "online" ? "#00ff96" : c.status === "away" ? "#ffc107" : "#3a3a4a", border: "2px solid #080d1a" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{c.time}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.38)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>{c.lastMsg}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 10, color: "#00d2ff", background: "rgba(0,210,255,0.1)", padding: "2px 7px", borderRadius: 8 }}>{c.lang}</span>
                  {c.unread > 0 && <span style={{ background: "#00ff96", color: "#080d1a", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{c.unread}</span>}
                </div>
              </div>
            </div>
            <button className="vcbtn" onClick={() => onCall(c)} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(0,255,150,0.28)", background: "rgba(0,255,150,0.07)", color: "#00ff96", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              📹
            </button>
          </div>
        ))}
      </div>

      {/* Bottom Nav */}
      <div style={{ display: "flex", background: "rgba(0,0,0,0.44)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.05)", padding: "10px 0 6px" }}>
        {[["💬","Chats",true],["📞","Calls",false],["👤","Profile",false]].map(([icon,label,active]) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "4px 0", cursor: "pointer" }}>
            <span style={{ fontSize: 22 }}>{icon}</span>
            <span style={{ fontSize: 10, color: active ? "#00d2ff" : "rgba(255,255,255,0.28)", fontWeight: active ? 600 : 400 }}>{label}</span>
            {active && <div style={{ width: 18, height: 2, background: "#00d2ff", borderRadius: 1 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
