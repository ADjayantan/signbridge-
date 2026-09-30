# SignBridge 🤟

A WhatsApp-style video-calling UI with a sign-language-to-caption overlay: when a signer is detected, a caption appears on the call in Tamil, Hindi, Malayalam, English or Arabic.

> **Status: UI prototype.** Sign detection and translation are **simulated**. A timer cycles through scripted sign → caption pairs; there is no camera input or ML model yet. See the [roadmap](#roadmap) for the plan to make detection real.

---

## Features

- 💬 Chat list with search and online / away / offline status
- 📹 Full-screen call screen with mic and camera toggles (UI state only)
- 🧏 Detection overlay: scan animation, bounding box and "sign detected" state
- 🌐 Captions overlaid on the call in 5 languages, including right-to-left Arabic
- ♿ Labelled controls and a screen-reader live region that announces each caption

## How the simulation works

`CallScreen` in `src/App.jsx` runs a loop every 5.8 s: show the scan animation, pick the next entry from `SIGN_TRANSLATIONS[language]`, show it as a caption, then fade out. All timers are cleared when the call ends.

## Tech stack

React 19 · Vite 8 · no backend

## Run locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Opens at **http://localhost:5173**.

```bash
npm run build     # production build → dist/
npm run preview   # serve the production build locally
```

## Deploy

- **Vercel:** import the repo at vercel.com/new. `vercel.json` sets the Vite build and `dist/` output.
- **Netlify:** import the repo at app.netlify.com. `netlify.toml` sets the build command, `dist/` publish folder and Node 22.
- **Netlify Drop:** run `npm run build`, then drag the `dist/` folder onto app.netlify.com/drop.

## Project structure

```
├── index.html        # Vite entry, fonts, global reset
├── src/
│   ├── main.jsx      # React root
│   └── App.jsx       # ChatList + CallScreen
├── vite.config.js
├── vercel.json
└── netlify.toml
```

## Roadmap

1. **Real camera:** `getUserMedia` for the self view.
2. **Real detection:** in-browser hand tracking and gesture recognition with MediaPipe, replacing the scripted loop.
3. **Real calls:** WebRTC between two browsers, with captions sent over a data channel.
4. **Indian Sign Language:** a classifier trained on hand-landmark sequences.
5. **Viewer-chosen caption language:** captions in the language of the person reading them, not the signer's.
