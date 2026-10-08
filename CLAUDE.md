# SignBridge: notes for Claude Code

Two-person conversation app (React 19 + Vite 8 PWA, Node `ws` room server) with experimental local ISL/ASL isolated-word sign recognition (MediaPipe Holistic landmarks into a GRU; Python training in `training/`). Owner: Jai, student project on a Windows laptop.

## Talking to Jai
- Reply in casual Tanglish (Tamil-English, "machan", "da"). Short and direct, strict mentor.
- Lead with what changed and what was verified on the real laptop. No long essays. Test counts are not progress.

## Run locally (Windows)
- Port 5173 belongs to another project. SignBridge uses **5174** (web) and **3001** (rooms).
- `npm run rooms`: room/WebSocket server on 3001 (loads `.env.local`).
- `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`: site at http://127.0.0.1:5174/. Vite proxies `/api/rooms`, `/api/health` and `/ws` to 3001. `predev` copies the ONNX runtime assets.
- Both servers are in `.claude/launch.json` (`rooms`, `web`); start both. Jai can also double-click `start-signbridge.cmd`.
- Screens (hash routes): `/#connect`, `/#trained-sign` (Sign Workspace), `/#training-studio`, `/#live-sign`, `/#voice`.

## Checks
- `npm run check`: Node tests + Vitest UI tests + production build.
- `npm run build:public`: deployable build without research models. Run it last before deploying.
- Python: `.\.training-venv\Scripts\python.exe -m unittest discover -s training -p "test_*.py"`

## Never
- Never print, log or commit `.env.local` (it holds `GEMINI_API_KEY`). Never put secrets in `VITE_*` variables.
- `public/models/`, `.training-data/`, `.training-venv/` and `training/artifacts/` stay local (gitignored; WLASL is non-commercial). Don't publish them.
- Don't lower recognition thresholds or force an expected word to make a demo pass.
- Automated tests are not device evidence. Report real camera/browser results separately.

## Honest state (8 Oct 2026)
- Rooms, chat, clarify/correction, meeting cards and WebRTC are built but tested only in two tabs on this laptop. **Not deployed** (no Render service, no Metered TURN), no two-device test.
- App sign models (`public/models/isl.json` 49 words, `asl.json` 100 words, 27-joint GRU): dataset top-1 ISL 75% / ASL 40.8%. ASL test signers overlap training (52 of 56); signer-disjoint ASL is 28%.
- **Zero verified live recognitions on Jai's webcam.** BOOK (4/4 on the dataset) and DRINK failed live. HELLO/STOP came from gesture shortcuts, not the model.
- A 75-joint GRU (ISL 89.6% top-1) is trained but not promoted; the graph model was worse. See `docs/graph-model-implementation-2026-10-04.md` and `docs/recognition-capture-diagnostic-2026-10-05.md`.

## Priorities, in order (no new features until #1 is answered)
1. **Replay test.** Run an original INCLUDE (ISL) sign video through the browser pipeline (video file into `usePoseTracking`, then the model) and compare with the offline prediction for the same clip. Recognized means the pipeline is fine and the gap is webcam data/signer; not recognized means a pipeline mismatch. Suspects: the 8 Hz sampling cap (125 ms in `src/hooks/usePoseTracking.js`); 4:3 webcam (640x480 in `src/hooks/useCamera.js`) while features have no aspect correction; Tasks Holistic versus the older Solutions Holistic used for training; the MediaPipe warning "NORM_RECT without IMAGE_DIMENSIONS" seen in the Vite logs. INCLUDE videos: https://zenodo.org/records/4010759
2. **Deploy.** Render free web service (`render.yaml`: build `npm ci && npm run build:public`, start `npm start`) plus Metered Open Relay TURN env vars, then test laptop Wi-Fi with an Android phone on mobile data. Steps: `docs/conversations-deployment.md`. Jai creates the accounts and keys himself.
3. **Webcam data, ISL only.** 10 to 12 ISL words from 3 or 4 people via Training Studio export, `training/import_samples.py`, retrain (start from the 75-joint contract), test on a held-out person.
