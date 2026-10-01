// Short tones that tell a blind user what the assistant is doing, without words.
let context = null;

function audio() {
  if (typeof window === "undefined") return null;
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
  }
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
}

function play(notes, { type = "sine", volume = 0.12, length = 0.11, gap = 0.02 } = {}) {
  const ac = audio();
  if (!ac) return;
  let t = ac.currentTime + 0.01;
  for (const frequency of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
    t += length + gap;
  }
}

export const earcon = {
  listen: () => play([587, 880]), // rising: I'm listening
  stop: () => play([880, 587]), // falling: stopped listening
  send: () => play([1046], { length: 0.07, volume: 0.08 }), // got it, thinking
  thinking: () => play([523], { length: 0.05, volume: 0.04 }), // still thinking
  error: () => play([311, 233], { type: "triangle", length: 0.16 }),
};
