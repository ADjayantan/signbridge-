// Languages the assistant can reply in. Codes must match LANGUAGES in server/chat.js.
export const LANGUAGES = [
  { code: "en", name: "English", native: "English", bcp47: "en-IN" },
  { code: "ta", name: "Tamil", native: "தமிழ்", bcp47: "ta-IN" },
  { code: "hi", name: "Hindi", native: "हिन्दी", bcp47: "hi-IN" },
  { code: "ml", name: "Malayalam", native: "മലയാളം", bcp47: "ml-IN" },
  { code: "te", name: "Telugu", native: "తెలుగు", bcp47: "te-IN" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", bcp47: "kn-IN" },
];

export function language(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}
