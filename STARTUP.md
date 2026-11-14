# SignBridge startup note

Read this first after a cold start: a new Claude session, a context reset, a long break or a reboot.
CLAUDE.md holds the standing rules (how to talk to Jai, ports, what never to do, priorities). This
note says where the work stands. Whoever changes that state updates this note before stopping.

Last updated: 14 Nov 2026, with the Vercel + Render hosting prep. `main` was pushed to GitHub that day.

## Wake up
1. `git status -sb` and `git log --oneline -8`: has anything moved since this note?
2. Start both servers from `.claude/launch.json` (`rooms`, then `web`). Outside Claude, double-click
   `start-signbridge.cmd`; `stop-signbridge.cmd` stops only what it started; logs go to `logs/local/`.
3. Open http://127.0.0.1:5174/#trained-sign. Rooms health: http://127.0.0.1:3001/api/health.
4. `npm run check`. At this note: 422 Node tests, 573 UI tests and the build pass.
5. Tell Jai in two lines what works and what you will do next, then do it.

## Where the work stands

### Sign recognition: still the open problem
These are dated reports, not fresh checks.
- No verified live recognition on Jai's webcam (CLAUDE.md, "Honest state").
- One known clip works: the INCLUDE ISL HELLO validation video
  (`.training-data/replay/isl-hello-validation-MVI_9917.MOV`) was recognized through the browser
  upload path, with speech, on 22 Oct. A known reference, not an accuracy result.
- 13 Oct browser-pipeline study (60 INCLUDE videos, two frozen candidates): the better candidate
  accepted 1 of 2 HELLO and 2 of 8 known test videos. Nothing was promoted.
- WLASL (ASL) local integration has been pending since 26 Oct; the checkpoint is in
  `C:\Users\adjay\Projects\WLASL`. Its preprocessing must match the official evaluation before any
  result counts.
- Long history: `docs/ARGON_MASTER_PROMPT_2026-10-26.md` (a handoff written for another assistant).

### Interface: done 13 to 14 Nov
- "Mocha cafe" print style: espresso ink, latte paper, coffee / caramel / honey spot colours,
  Fraunces headings, Atkinson Hyperlegible body, and a Paper / Ink / Auto switch.
- Colours are role-named tokens in the `:root` block of `src/styles/halftone.css`. JS fallbacks
  (WebGL, jsdom, browser chrome, PWA manifest) are in `src/lib/printPalette.js`. Change both together.
- Halftone canvases: `src/components/HalftoneField.jsx`. They hold a still frame while the camera
  runs and for reduced motion.
- Jai turned down two palettes before this one (cobalt + tangerine, then lilac pastel). Leave the
  colours alone unless he asks.

### 3D hands: done 12 to 14 Nov
- Sign stage: `src/components/InteractiveSign3D.jsx`, a sculpted WebXR hand (`public/hand3d/left.glb`,
  MIT) rigged in `src/lib/handModelRig.js` and loaded once per page by `src/lib/handModelLoader.js`.
  Skins: Real Skin (default), Halftone, Sculpt Gold. 20 signs via `get3DPoseForSign`; live mirroring
  in `src/lib/liveHandMirror.js`.
- Home hero: `src/components/BridgeScene.jsx`, two printed hands reaching for each other.
- Shared shader: `src/lib/halftoneShader.js` (the print pass and the Real Skin glow).
- Waiting on Jai: the one `TODO(human)`, in `liveWristRoll()` (`src/lib/liveHandMirror.js`). He said
  he would write it; don't fill it in.

### Rooms and deploy
- Rooms, chat, clarify/correction, meeting cards and WebRTC: tested in two tabs on this laptop only.
- A Render Free pilot went live on 8 Oct (`signbridge-conversations.onrender.com`, deploy `361a131`
  from `codex/render-pilot`), checked with synthetic clients only
  (`docs/render-pilot-verification-2026-10-08.md`). On 14 Nov its `/api/health` still answered
  `{"ok":true}` after a 24 s cold start. Auto-deploy is off, so unless someone redeployed by hand it
  runs the October build, not the November interface. No Metered TURN, no two-device test.
- To check the deployable build locally: `npm run build:public`, then the `public` entry in
  `.claude/launch.json` (production server on http://127.0.0.1:3101). On 14 Nov it served the site,
  answered `/api/health`, returned 404 for `/models/*` and served `/hand3d/left.glb`.
- Hosting plan (Jai chose it 14 Nov): site on Vercel, rooms on Render. Rooms can't move to Vercel
  (WebSocket connections end at the function's maximum duration, and partners can land on different
  instances while rooms live in one server's memory). `vercel.json` is ready, the app wakes Render
  when it opens (`src/lib/conversationServer.js`), and invites point at the Vercel page. The split
  passed a local two-origin test; nothing is deployed yet. Jai's steps, and why `GEMINI_API_KEY`
  must not go on Vercel: `docs/conversations-deployment.md`, "Vercel front end, Render rooms".

## Not checked on a real device since the November work
Camera-on states with the real webcam, reduced motion, browsers without `light-dark()`, a phone over
the network.

## Next, in order
1. Replay test (CLAUDE.md priority 1). The parts exist: `src/components/SignVideoInput.jsx` and
   `src/hooks/useVideoPoseReplay.js` feed a video file through the browser pose pipeline;
   `src/components/RecognitionReplay.jsx` and `src/lib/recognitionReplay.js` record what happened.
   Before redoing work, read what October already measured: the diagnostics in
   `.training-data/replay/` (for example `archive-sampling-8hz-diagnostic.json`) and the 13 Oct and
   22 Oct docs. This note did not re-read them.
2. Deploy: bring the Render service up to current `main` (`docs/conversations-deployment.md`), then
   laptop Wi-Fi plus an Android phone on mobile data. Jai creates accounts and keys himself.
3. Webcam data, ISL only (CLAUDE.md priority 3).

## Gotchas
- Port 5173 belongs to another project. SignBridge is 5174 (web) and 3001 (rooms).
- Editing `vite.config.js` restarts Vite, and the console then shows stale "Failed to reload" HMR
  errors. Reload the page before reading it.
- The browser pane can return the frame from before a click. Take a second screenshot before judging.
- After a theme switch, freeze CSS transitions before measuring contrast, or you read half-faded
  colours.
- In Vitest (jsdom) `import.meta.url` is an http: URL, so tests read files from the project root (see
  `tests/ui/bridgeScene.test.jsx`).
- `npm run build:public` (no research models) is the only build to deploy.
