# SignBridge 🤟

**An AI assistant that Deaf and blind people can talk to.** Sign to the camera, or speak out loud. SignBridge answers in large, simple text or in speech, in English, Tamil, Hindi, Malayalam, Telugu and Kannada.

| Sign mode | Voice mode |
| --- | --- |
| ![Sign mode: hand skeleton tracked on a real hand, the sign HELLO recognized and answered](docs/screenshots/sign-mode.png) | ![Voice mode: listening, with the live transcript and the conversation below](docs/screenshots/voice-mode.png) |

- **Sign mode** (Deaf and hard of hearing): the camera tracks your hands on your own device. Hold a sign and it becomes a word; lower your hands and the words go to the AI, which works out the sentence you meant and replies. It can also say your words aloud for hearing people nearby.
- **Voice mode** (blind and low vision): talk and hear the answer, hands-free, like a voice assistant. Answers start playing while the AI is still writing. Everything works from the keyboard and with screen readers. Turn on the camera and ask "what's in front of me?" or "read this label".

## How it works

```
SIGN   camera ─► MediaPipe Gesture Recognizer (WebAssembly, on device)
                 ─► 21 landmarks per hand ─► features ─► taught signs (k-NN) + 7 built-in gestures
                 ─► smoother (hold 0.7 s) ─► words ─► /api/chat ─► Gemini ─► { meaning, reply } ─► big text

VOICE  mic ─► Web Speech API ─► /api/chat (streaming) ─► Gemini ─► sentence splitter ─► speech ─► listen again
                                    ▲ optional camera photo
```

- **Hand features** (`src/lib/features.js`): each hand is described in its own 3D frame (wrist, middle knuckle, knuckles across the palm), so a handshape gives the same numbers wherever it is, at any distance and at any tilt. Hand direction and palm direction are added separately, because orientation matters in sign language (👍 vs 👎). Signs taught with one hand also work with the other (mirroring).
- **Teach your own signs** (`src/lib/knn.js`): record a sign for 2.5 s; SignClassifier stores the frames and recognizes them with k-nearest neighbours. Frames that are far from every taught sign are rejected, using a per-sign threshold calibrated from that sign's own samples.
- **Smoother** (`src/lib/signSmoother.js`): a word is added only after it has been the steady prediction for 0.7 s, and the same word again only after the hands change.
- **AI proxy** (`server/chat.js`): the only code that talks to Gemini. The API key stays on the server. Voice answers stream as NDJSON; sign answers use Gemini's JSON schema output.
- **Speed**: hand tracking picks MediaPipe's GPU or CPU backend. On machines where the GPU runs in software (lab PCs without drivers, VMs), the GPU backend is about 20× slower, so SignBridge detects that and uses the CPU.

## Measured accuracy

Measured with MediaPipe on 128 real photos from the [HaGRID](https://github.com/hukenovs/hagrid) dataset, where every photo is a different person:

| What | Result |
| --- | --- |
| Hands found in gesture photos | 110 of 116 (95%) |
| Built-in gestures recognized (✋ 👍 👎 ✊ ☝️ ✌️, above the app's confidence cut-off) | 71 of 78 (91%) |
| Photos without a built-in gesture that still produced one (mostly 🤙 read as 👍) | 5 of 38 |
| Taught signs recognized for people who didn't teach them (3–5 signs, about 6 photos each) | 73 of 77 (95%) |
| Untaught handshapes correctly ignored | 117 of 172 (68%) |

When the same person teaches and uses the signs, as intended, recognition is easier than this. Taught signs take priority over built-in gestures, so teaching 🤙 fixes the 🤙/👍 mix-up.

## What works today, and what doesn't yet

- ✅ Real-time hand tracking, built-in gestures, teaching and recognizing your own **static** signs (one or two hands), AI replies, streaming speech, camera descriptions.
- ❌ **Moving signs and full ISL sentences.** Many Indian Sign Language signs need motion; that needs a sequence model (see the roadmap). For now, teach the key handshape.
- ⚠️ Speech input needs Chrome or Edge. Voices depend on the browser: Edge has natural Indian voices, including Tamil; Chrome on Windows usually has no Tamil voice unless one is installed in Windows. SignBridge warns when a voice is missing.
- ⚠️ Not a mobility aid. The AI is told never to say that something is safe.

## Run it locally

Needs Node.js 20.19+ (or 22.12+) and a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
npm install
cp .env.example .env.local      # then put your key in GEMINI_API_KEY
npm run dev                     # http://localhost:5173
npm test                        # 52 unit tests
```

The dev server also runs the AI endpoint (`/api/chat`), so no separate backend is needed.

## Deploy on Vercel

1. Import this repository at [vercel.com/new](https://vercel.com/new). `vercel.json` already sets up the Vite build.
2. In **Settings → Environment Variables**, add `GEMINI_API_KEY`. Optionally set `ALLOWED_ORIGINS` to your site's URL so other sites can't use your key.
3. Deploy. Camera and microphone need https, which Vercel provides.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | required | Your Gemini key (server only) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Fastest Gemini model; try `gemini-3.8-flash` for harder questions |
| `GEMINI_THINKING_LEVEL` | model default | `minimal`, `low`, `medium` or `high` |
| `ALLOWED_ORIGINS` | any | Comma-separated sites allowed to call `/api/chat` |

## Keyboard

| Where | Keys |
| --- | --- |
| Home | <kbd>V</kbd> voice mode · <kbd>S</kbd> sign mode |
| Voice mode | <kbd>Space</kbd> talk / interrupt · <kbd>Esc</kbd> stop · <kbd>R</kbd> repeat · <kbd>C</kbd> camera · <kbd>H</kbd> hands-free · <kbd>+</kbd> <kbd>−</kbd> speech speed |
| Sign mode | <kbd>Enter</kbd> send · <kbd>Backspace</kbd> delete last word · <kbd>Esc</kbd> clear |

Bookmark `/#voice` to open straight into voice mode.

## Privacy

- **Sign mode:** camera video is processed in the browser and never uploaded. Only the recognized words go to the server.
- **Voice mode:** the browser's speech service turns speech into text (Chrome and Edge use Google's and Microsoft's servers). The text goes to Gemini through SignBridge's server. Camera photos are sent only while the camera switch is on.
- **Taught signs** are stored in your browser. Use Export / Import to move or share them.

## Project structure

```
api/chat.js              Vercel Function → server/chat.js
server/chat.js           Gemini proxy: validation, prompts, streaming, errors
src/lib/features.js      hand landmarks → feature vector (+ mirroring)
src/lib/knn.js           SignClassifier for taught signs
src/lib/signSmoother.js  per-frame predictions → words
src/lib/gestures.js      built-in gestures and the per-frame decision
src/lib/handTracker.js   MediaPipe loading, GPU/CPU choice
src/lib/speech.js        speech recognition and speech output
src/lib/text.js          sentence splitter and markdown cleaner for speech
src/hooks/               camera, hand tracking, voice assistant loop, settings
src/modes/               Home, VoiceMode, SignMode, TeachSigns
tests/                   unit tests (node:test)
```

## Testing

- `npm test` runs 52 unit tests: features (invariance, mirroring), classifier, smoother, text splitting, the API client and the server (validation, streaming, error mapping).
- End-to-end checks were run in headless Chromium: real MediaPipe on a fake camera playing HaGRID photos (gestures → words → auto-send → reply; teaching a sign and recognizing it; export/import), the voice loop with simulated speech (streaming speech, hands-free, interrupt, errors, Tamil, camera photo, screen-reader mode), and axe-core with 0 accessibility violations in light and dark themes.

## Roadmap

1. **Moving signs and real ISL vocabulary.** Train a small sequence model (GRU or Transformer) on landmark sequences from [INCLUDE](https://zenodo.org/records/4010759): 263 ISL word signs in 4,287 videos, recorded by Deaf students at St. Louis School for the Deaf, Chennai.
2. **Gemini Live for voice mode:** native audio, lower latency and natural interruptions.
3. **Gemini TTS fallback** for languages the browser can't speak, such as Tamil in Chrome.
4. **Bridge mode:** a hearing person speaks and the Deaf user reads live captions, so the two can talk face to face.
5. **Rate limiting** on `/api/chat` per user, to protect the API key's quota on public deployments.

## Tech stack

React 19 · Vite 8 · MediaPipe Tasks Vision 1.0.1 · Gemini API · Vercel Functions · Web Speech API

Built by [Jayantan](https://github.com/ADjayantan).
