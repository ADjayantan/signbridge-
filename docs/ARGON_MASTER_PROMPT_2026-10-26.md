# SignBridge — Gemini Argon master continuation prompt

Prepared on **26 October 2026, Asia/Calcutta**. This is a detailed handoff, grounded in the supplied conversation history, local source files, saved reports and a fresh read-only audit. It is **not a verbatim export of every conversation turn**. Historical results are labelled with their dates; they are not fresh validation of the current working tree.

**How to use:** Give this entire document to Gemini Argon. If Argon has laptop filesystem access, ask it to read this file and the two companion files before editing. If it cannot read local files, attach all three files. The short startup instruction is at the end.

---

## 1. Your assignment

You are continuing **SignBridge**, an existing accessibility and human-communication project. Work on the existing implementation; do not start another application or replace it with a mockup.

The user's central requirement is:

> A person signs into the laptop camera, or supplies a video of a sign. The system recognizes the meaning and shows readable text, with voice output when enabled. A partner who does not understand signing can understand that message. The partner can reply using speech or typing; the signer receives readable text and an appropriate sign video when a verified matching clip is available.

The user also wants a Gemini Live / voice-assistant-like experience in which signing can be used to communicate with an AI. Keep **human conversation** and **AI conversation** clear: the same recognized/reviewed meaning may be routed to the selected destination, but a partner message must never silently become an AI request.

The user says: “macha, this model has to work; I need a visible result.” They have repeatedly experienced a camera preview with hand joints and no recognized text or speech. A polished interface, a large test count, or another plan does not satisfy the main goal.

The immediate task after reading this handoff is to diagnose and complete the existing recognition paths, demonstrate actual video-to-text/voice behavior, and explicitly identify remaining webcam limitations. The current requested handoff did not itself finish the pending WLASL integration.

## 2. Essential user context

- The user communicates in Tamil/Tanglish and English. Explain progress simply and briefly; keep technical details in documents and diagnostics.
- The user does not know sign language and does not currently know a fluent signer who can validate their demonstrations. Their imitation cannot automatically be treated as verified training ground truth.
- The user wants ISL and ASL. They explicitly answered “both” earlier, and selected ISL during the failed HELLO webcam attempts. **ISL and ASL are different languages.** Never silently mix their labels, models or reply clips.
- Their expected everyday interaction is camera on → make a complete sign → text/optional voice. They do not want to hunt for Capture/Finish buttons for every turn. Manual recording remains useful for diagnosis.
- They specifically wanted an open palm/HELLO demonstration. Do not solve this by pretending that every open palm means ISL HELLO. A separately labelled gesture shortcut is a different feature and cannot prove sign-language understanding.
- They want a professional app which connects people, **without categorizing users by disability**. Offer Type / Speak / Sign and Text / Read aloud / Sign video / Screen reader preferences.
- Low reading fluency matters to the intended usability scenario. It is not a consequence of deafness or inability to speak. Avoid dense technical screens in the normal flow.
- Earlier there was submission/advisor-demo urgency. A “tomorrow” request in older history is not a current calendar deadline. Confirm a current deadline only if necessary; do not repeat a stale date.
- Hardware/Braille was discussed, including a ₹1,500 budget, but software comes first. A Braille prototype and compatibility evaluation are later work.
- Use free infrastructure unless the user explicitly changes that constraint. Do not purchase GPU/cloud resources or upgrade Render.
- The user authorized implementation, fixing, testing, and previously GitHub/Render work. Preserve their project and secrets. Do not request passwords/API keys in chat or ask the same preference questions again.

## 3. Exact locations — start here

| Purpose | Actual path / address |
|---|---|
| Active SignBridge app | `F:\Downloads\signbridge` |
| This master prompt | `F:\Downloads\signbridge\docs\ARGON_MASTER_PROMPT_2026-10-26.md` |
| Detailed conversation/decision history | `F:\Downloads\signbridge\docs\ARGON_CONVERSATION_HISTORY_2026-10-26.md` |
| Machine-readable audit/inventory | `F:\Downloads\signbridge\docs\ARGON_VERIFIED_STATE_2026-10-26.json` |
| Local sign workspace | `http://127.0.0.1:5174/#trained-sign` |
| Local conversations | `http://127.0.0.1:5174/#connect` |
| Local Training Studio | `http://127.0.0.1:5174/#training-studio` |
| Local room server | `http://127.0.0.1:3001` |
| Public conversation pilot, historically deployed | `https://signbridge-conversations.onrender.com/#connect` |
| Git remote | `https://github.com/ADjayantan/signbridge-` |
| WLASL research project | `C:\Users\adjay\Projects\WLASL` |
| WLASL videos | `C:\Users\adjay\Projects\WLASL\start_kit\videos` |
| WLASL source metadata | `C:\Users\adjay\Projects\WLASL\start_kit\WLASL_v0.3.json` |
| WLASL missing list | `C:\Users\adjay\Projects\WLASL\start_kit\missing.txt` |
| WLASL I3D code | `C:\Users\adjay\Projects\WLASL\code\I3D` |
| WLASL Python | `C:\Users\adjay\Projects\WLASL\.venv\Scripts\python.exe` |
| WLASL source | `https://github.com/dxli94/WLASL` |

Important path corrections:

- Old SignBridge reports use `C:\Users\adjay\Downloads\signbridge`. That checkout moved to **F:\Downloads\signbridge**. Resolve old report/artifact links relative to the current root.
- `F:\Downloads\signbridge-fixed\signbridge` is an old starter, not the current application.
- The chat's default terminal directory may be `C:\Users\adjay\OneDrive\Documents\ChatGPT\clg`. That is **not** the app root. Supply the correct working directory explicitly.
- Port 5173 was used earlier and may belong to another application. The owned launcher uses **5174**, strict port, and **3001**.
- Fresh audit on 26 October found **neither 5174 nor 3001 listening**. A screenshot/old tab does not establish that the server is running now.
- No Python training process was running after the audit. GPU was an RTX 4060 Laptop GPU, 8,188 MiB, idle at that snapshot.

## 4. Repository state and preservation

Fresh inspection found branch **`codex/sign-speech-video`**, HEAD **`5451d08`**, subject `feat: add sign-speech video rooms, graph sign model and training pipeline`.

There are many modified and untracked files, including substantial work from multiple earlier sessions. This is a live working tree, not a clean release. The current disk contents are newer than the last commit.

Before editing:

1. Read applicable repository instructions, `git status --short`, relevant source and the companion audit.
2. Do not reset, clean, overwrite the checkout, run a wholesale checkout, or stage every file.
3. Do not assume all dirty changes belong to your task. Make small scoped changes and inspect their diff.
4. Do not read or print `.env.local`. `.env.example` documents names without credentials.
5. Do not put raw research videos, recordings, model weights, training data or secrets in Git/public assets.
6. `.training-data/`, `.training-venv/`, `training/artifacts/`, `public/models/**`, `dist`, `node_modules`, logs and env files are ignored for good reasons.
7. Do not delete old experiments/checkpoints to make results look cleaner. Preserve provenance and failed runs.

The public Render deployment uses a different historically deployed branch, `codex/render-pilot`. Do not assume the current local branch or latest dirty files are deployed.

## 5. Honest current capability summary

| Area | Current state | What remains unproved / missing |
|---|---|---|
| Rooms/text | Two-person room creation/join, credential-based reconnect, reviewed messages, order/IDs/receipts and workflow controls exist. | Physical two-device acceptance should still be performed. |
| Live video/audio | WebRTC controls, local/partner video, reconnect and ICE/TURN support exist. | Actual cross-network and forced-relay trials remain separate from synthetic tests. |
| Speech input | Browser speech recognition creates editable drafts. | Browser/runtime availability and real microphone behavior require checking. |
| Text to voice | Browser speech synthesis, retry/stop controls exist. | A speech `end` event is not proof a human heard a speaker. |
| Hand/body tracking | MediaPipe tracking and visible joints exist. | Joints do not prove word recognition. |
| Legacy sign recognition | Local ISL 49-word and ASL 100-word research JSON models exist. | User webcam recognition is unreliable; no universal/continuous translation. |
| ISL uploaded-video demo | One known HELLO reference was recognized and browser speech completed on 22 October. | Not an unseen-video, new-signer or webcam accuracy result. |
| Automatic capture | Moving-sign segmentation and held-pose capture exist. | Capture success does not imply a correct word; framing gates can block capture. |
| WLASL I3D integration | Python, middleware, UI and test files exist as partial new work. | **Not routed or registered in the app; real integration bugs and failed tests remain.** |
| Training Studio | Consented local pose collection, no-sign recording, inventory/export exist. | Saving examples does not train or deploy a model. |
| Sign replies | Device-local saved phrase videos can be matched/played; uncovered words remain visible. | No general text-to-sign translator, broad verified library, or fluent signing avatar. |
| AI | Optional reviewed-text assistance and experimental tools exist. | AI must not invent recognition results; human conversation must work without Gemini. |
| UI | Three.js decoration and redesigned workspace were added. | Prioritize recognition and clarity over more decoration. |
| Braille | Discussed as a later phase. | No completed Braille hardware/compatibility validation established here. |

## 6. App architecture and source map

Stack from current `package.json`: React 19.3, Vite 8.3, Three.js 0.186, MediaPipe Tasks Vision 1.0.1, ONNX Runtime Web 1.30, ws 8.22, Vitest 5, Testing Library. Node requirement is **>=22.12**. Follow the lockfile; do not casually upgrade the stack while debugging.

All app paths below are relative to `F:\Downloads\signbridge`.

### Navigation and settings

- `src/App.jsx`: mode routing and transfer of reviewed text to conversation draft.
- `src/hooks/useHashMode.js`: whitelist of modes. Current routes: home, connect, voice, sign, live-sign, trained-sign, sign-workspace, training-studio, sign-videos. **No wlasl route yet.**
- `src/modes/Home.jsx`: entry points and tools.
- `src/hooks/useSettings.js`: app settings, default ISL, English, gesture shortcuts off, optional video replies.
- `src/hooks/useCommunicationPreferences.js`: per-device room defaults Type/Text/ISL/English; saved sign videos off in room preferences.
- Defaults vary by screen. Do not assume app-level `videoReplies` means the room has every reply clip available.

### Existing sign recognition and capture

- `src/modes/TrainedSignMode.jsx`: main sign workspace; input source, camera/video, review, local voice, draft, optional AI, training save.
- `src/hooks/useWordRecognitionModel.js`: explicit legacy vs graph model selection; no silent fallback.
- `src/hooks/useTrainedModel.js`, `src/lib/trainedSignModel.js`: legacy JSON load/inference.
- `src/hooks/useGraphSignModel.js`, `src/lib/graphSignModel.js`: graph/ONNX research path.
- `src/lib/cameraWordRecognition.js`: camera turn quality/acceptance and diagnostics.
- `src/lib/automaticSignCapture.js`: motion/held-pose segmentation, no semantic recognition.
- `src/hooks/usePoseTracking.js`, `src/lib/poseTracker.js`, `src/lib/legacyPoseTracker.js`: tracker lifecycle/adapters.
- `src/hooks/useCamera.js`, `src/lib/cameraFrameHealth.js`: camera lifecycle and health.
- `src/lib/poseCaptureContext.js`, `src/lib/cameraCoordinateContract.js`: capture dimensions/provenance and coordinate contract.
- `src/components/SignVideoInput.jsx`, `src/hooks/useVideoPoseReplay.js`: file input through the same actual pose recognizer.
- `src/components/GuidedSignPractice.jsx`: example/practice guidance.
- `src/components/RecognitionReplay.jsx`, `src/lib/recognitionReplay.js`, `src/lib/signRecognitionReport.js`: reproducible diagnostics.
- `src/lib/speech.js`: local browser text-to-speech; use this existing service.

### Rooms, reply media, AI

- `src/modes/ConnectMode.jsx`, `src/components/RoomSignCapture.jsx`: partner conversation and reviewed sign words.
- `src/hooks/useRoom.js`, `src/lib/roomClient.js`, `src/lib/roomWorkflow.js`: messages, reconnect and workflow.
- `src/hooks/useRoomMedia.js`, `src/lib/mediaRoute.js`: WebRTC/media lifecycle.
- `server/roomServer.js`, `server/rooms.js`, `server/iceServers.js`: room HTTP/WebSocket server, message state and relay settings.
- `src/lib/signVideos.js`, `src/hooks/useSignVideos.js`, sign-video player components: saved clips/planning/storage.
- `server/chat.js`, `server/nodeChatMiddleware.js`, `api/chat.js`: optional Gemini API path.
- Existing assistant hooks are not the room's speech-draft state; keep them separate.

### Training

- `src/modes/TrainingStudio.jsx`, `src/components/NonsigningCapture.jsx`, `src/lib/trainingSamples.js`: explicit consent and local collection.
- `training/import_samples.py`: data validation/provenance, not automatic training.
- `training/graph_models.py`, `train_graph_models.py`, `evaluate_graph_models.py`, `export_graph_model.py`: GRU75/ST-GCN and related experiments.
- `training/train_temporal_baseline.py`: separate GRU/LSTM comparison with coordinate prerequisites.
- `training/camera_aligned_study.py`, `train_tasks_video_study.py`, `train_tasks_video_stage2.py`: frozen research studies; do not overwrite their outputs or tune on their already examined test sets.

## 7. Existing HELLO behavior: exact facts and gaps

### Verified known-reference result, 22 October

Reference file:

`F:\Downloads\signbridge\.training-data\replay\isl-hello-validation-MVI_9917.MOV`

- Previously examined INCLUDE ISL validation reference, not a new unseen test.
- Video SHA-256: `61a50323776fe04f732aba8668a1ea8fac09c17d387af26c78a94412f003e7ff`.
- Active `public/models/isl.json` SHA-256: `55c23fffe387944a102c804676ae91aa7276781d598b7adaf03f0115234acdd9`.
- Source duration 1,960 ms; 16 source samples; hands and shoulders detected in all 16.
- Result HELLO; model score `0.9836577181667145`; runner-up CELL PHONE `0.005837693666860342`; margin `0.9778200244998542`.
- Text appeared in result/review; browser speech reported completion. Physical audibility was not confirmed.
- Evidence: `docs/sign-video-to-text-voice-2026-10-22.md`, `docs/sign-video-hello-report-2026-10-22.json`, `docs/sign-video-hello-2026-10-22.jpg`.

Do not describe that score as “98.36% accurate.” It is one model output score on one known reference.

### Current output behavior

- `recognizeTurn()` clears stale review/speech before processing the next turn. Preserve this fix.
- An accepted result populates the **result and editable meaning field**.
- The separate Step 3 message textarea (`#trained-message`) is still composed explicitly with `append()` / Add word to message. It does **not** automatically append every recognized word. This remains a gap relative to the user's requested convenience.
- `speakResults` initially false; the **Start camera + read aloud** action enables it. Rejected/uncertain results remain silent.
- Automatic speech is currently limited to accepted legacy results when voice was requested. Graph/uncalibrated WLASL suggestions must not be silently spoken as verified meanings.
- Review before remote Send/AI remains intentional. If adding opt-in auto-append for accepted local words, use turn IDs, preserve edits/drafts, support deliberate repeats and prevent duplicate speech/appends.

### Why the user's webcam can fail

The user/Gemini supplied the wrist-clipping and shoulder diagnosis. Source confirms the relevant gates, but each failed turn still needs measured evidence rather than assuming one universal cause.

- Automatic capture treats a tracked joint at `x/y <= .02` or `>= .98` as clipped. A wrist at the bottom edge can reset framing.
- Both shoulder confidences must be >= .2 and shoulder separation >= .05 for this segmentation framing check.
- Moving capture defaults: framing 300 ms, pre-roll 300 ms, onset 180 ms, quiet finish 700 ms, missing-hands finish 600 ms, max 8 seconds/100 frames, cooldown 700 ms.
- Still pose capture **already exists**: held pose 1,200 ms with bounded movement/rearm. Old claims that still capture is wholly absent are stale.
- Tracker sampling is capped around eight samples/second in the pose pipeline; configured intervals are not proof of achieved frame rate.
- A proposed onset/pre-roll improvement was **not implemented**: buffer filtering follows `nowMs` while waiting for onset confirmation, potentially losing pre-onset context. Investigate with a regression fixture before changing it.
- Camera dimensions can fall back to 640×480 despite requesting widescreen. Capture metadata records actual decoded size.
- A standing/full-body training source and a seated laptop webcam can differ substantially in pose geometry, scale, visibility, framing and movement. A dataset-domain mismatch is plausible; it is not solved by lowering the score threshold.
- Historical ISL coordinate contract uses explicit axis conversions (x 1080, y 1920). Inspect manifest and source before changing it; aspect ratio and coordinate convention must match training.
- Existing legacy acceptance is ISL score >= .95 and ASL score >= .98, with margin >= .30 for both current local models. Do not lower gates merely to force HELLO/FATHER/CANDY output.

## 8. WLASL: what the user supplied and what was actually found

The user supplied a Claude handoff claiming 11,301 videos, 24 fixes to the 2020 code, WLASL100 I3D training on RTX 4060 and roughly three minutes/epoch. The local audit verified the video inventory and available code/checkpoint; **the complete list of 24 claimed fixes and the three-minute estimate were not independently reproduced**.

Referenced Claude artifact: `https://claude.ai/artifact/4CbNkWb4kGkSkNqTnGZ6oB`. Its complete contents were not retrieved; do not claim to have read it.

### Data and environment, fresh audit

- Total downloaded `.mp4` files: **11,301**. The user's original full-release count was 21,083 (about 53.6% downloaded); available subsets must be audited separately.
- WLASL is **ASL isolated-word** data, not ISL and not continuous sentence translation.
- Official 100-class split file: `code/I3D/preprocess/nslt_100.json`.
- Ordered labels: `code/I3D/preprocess/wlasl_class_list.txt`, first 100 numeric IDs.
- Official train/val/test counts: **1,442 / 338 / 258**.
- Available train/val/test clips: **769 / 193 / 169**, total 1,131.
- Classes represented: **100 / 98 / 92**. All 100 classes have training examples; not all have available validation/test examples.
- Missing validation classes: LAST, TELL. Missing test classes: BOOK, THANKSGIVING, LATER, SHIRT, DOCTOR, SHORT, CHEAT, RIGHT.
- BOOK and DRINK are in the vocabulary. **HELLO and THANKS are not in WLASL100.** This new model cannot satisfy the requested HELLO demonstration merely by being integrated.
- Separate Python environment: `.venv\Scripts\python.exe`; previously inspected torch 2.14.1+cu130, OpenCV 5.0.0, CUDA available. Recheck versions when running.
- GPU: NVIDIA GeForce RTX 4060 Laptop GPU, 8,188 MiB. Do not assume free cloud hosting has this GPU.

### Original local training did not yield a usable model

- Existing checkpoint: `code/I3D/checkpoints/nslt_100_000160_0.023669.pt`.
- Existing log: `code/I3D/logs/train_wlasl100_20261025_2046.log`.
- Logged first-epoch result was **4/169 = 2.3669% top-one**. It was evaluation on the original code's test path, not a properly untouched final test after clean selection.
- Log stopped in epoch 2; there is no evidence it is training now. No Python process/new checkpoint was present at this handoff.
- Original `train_i3d.py` combines train+validation and repeatedly evaluates test; audit also found incorrect backward behavior in evaluation, selection/resume issues. Do not present this run as a sound benchmark or simply continue it to “fix accuracy.”
- `weights/rgb_imagenet.pt` is action/backbone initialization, not an already capable 100-word sign translator.

### Official pretrained WLASL100 checkpoint downloaded locally

Using the pretrained-weights link in the official repository, the previous implementation session downloaded:

- `code/I3D/weights/wlasl-official-archived.zip` — 197,120,381 bytes.
- Extracted model: `code/I3D/archived/asl100/FINAL_nslt_100_iters=896_top1=65.89_top5=84.11_top10=89.92.pt` — 49,677,763 bytes.
- SHA-256: `a61d7dda5f875ce5ebd9d407c56874f77d1cd2aeb4bc7cd0d98a6e1ca4669a0c`.
- The 65.89/84.11/89.92 figures are in the upstream filename, **not measurements reproduced by this project**.
- Archive source linked by upstream: `https://drive.google.com/file/d/1jALimVOB69ifYkeT0Pe297S1z4U3jC48/view`.

Use the local files; do not redownload/recollect the entire dataset unnecessarily. The WLASL repository and local `start_kit/C-UDA-1.0.pdf` restrict use to the applicable research terms. Code licensing does not give universal redistribution/commercial rights to recordings. Keep videos/weights local and inspect the exact applicable terms before any distribution.

## 9. Partial WLASL implementation — blockers to finish first

### Files already created

Under SignBridge:

- `scripts/wlasl_infer.py`
- `server/localWlaslMiddleware.js`
- `tests/localWlaslMiddleware.test.js`
- `src/modes/WlaslVideoMode.jsx`
- `src/styles/wlaslVideo.css`
- `tests/ui/wlaslVideo.test.jsx`

Under WLASL `code/I3D`:

- `signbridge_i3d.py`
- `train_signbridge.py`
- `test_signbridge_training.py`

These files' presence is not end-to-end completion.

### Blocker A — not wired

- `src/App.jsx` has no WlaslVideoMode import/route.
- `src/hooks/useHashMode.js` has no `wlasl` mode.
- Home and Sign Workspace have no completed entry point to that new screen.
- `vite.config.js` has not imported/registered `localWlaslPlugin(mode)`.
- Consequently `/#wlasl` is **a proposed route, not a working current link**.

### Blocker B — real Python/Node contract mismatch

`scripts/wlasl_infer.py` returns model name `Official WLASL100 I3D · local research`. Middleware's model-name regular expression permits ASCII characters but not the middle dot `·`. Real status/prediction payloads are therefore rejected by the middleware validator. A successful Python `--status` alone does not establish working HTTP integration.

Fix the contract deliberately and add a test that uses the real response shape. Do not broadly remove validation to get a green test.

### Blocker C — preprocessing mismatch and failed real prediction

Current bridge contract string is `wlasl-official-bgr-square256-center224-uniform64-v1`:

1. Decode OpenCV BGR, bounded duration/size.
2. Force every frame to 256×256, center crop 224×224.
3. Uniformly sample 64 frames.
4. Scale to [-1,1], tensor `[1,3,64,224,224]`.
5. I3D, temporal max logits, softmax, top five suggestions.

A previous actual GPU run on available BOOK validation video `start_kit/videos/70212.mp4` gave **FAMILY .296646**, FINISH .145558, WANT .075777, **BOOK .043946**, MANY .025220. Source was 100 frames/4 seconds; recorded inference phase about 411 ms. This is a **failure**, not a working BOOK demo. Preserve it in the diagnosis.

Reference-code inspection found that official evaluation (`datasets/nslt_dataset_all.py` and default `test_i3d.py run()`) uses BGR, conditionally upscales small frames, takes a center crop, feeds the full clip, and uses temporal-max logits. It does not universally square-resize and uniformly resample to 64 in that default path. The training loader has different resizing/window behavior. Therefore the current bridge's claim to match official inference is not yet established.

Next action: reproduce the official checkpoint's exact evaluation preprocessing on a fixed, declared small development set, compare tensors/contracts, and record results. Avoid choosing a pipeline merely because it happens to guess BOOK on one example. Follow source/model provenance, establish memory/duration bounds, then define any new webcam adaptation explicitly. Do not confuse old **BGR** weights with the separate new **RGB** trainer.

### Blocker D — fresh focused tests include failures

Read-only handoff audit on 26 October:

- WLASL training unittest: **10 passed**.
- Node middleware test: **13 passed, 1 failed**. Test `video content type, declared size, streamed size and empty bodies are bounded` hit `ECONNRESET / socket hang up` around `tests/localWlaslMiddleware.test.js:101`. Determine whether response/abort lifecycle or the test client is responsible; do not merely delete the check.
- Four focused UI files: **76 passed, 1 failed** (77 total). WLASL test `camera auto-finishes at 12 seconds and End session releases capture resources` at about line 129 expected timer count 0, got 1. Track stop and URL revocation assertions before that point passed. Investigate timer ownership/cleanup and test timing.
- Other focused files `automaticTrainedSign`, `videoSignWorkspace`, `signVideoInput` passed in that run.
- The full current `npm run check` was **not** run for this documentation handoff. Old all-pass counts do not override today's failures.

### Intended local bridge behavior to preserve

- Local-only, same-origin/loopback checks, fixed Python executable and arguments, no arbitrary filesystem path accepted from browser.
- `GET /api/local-wlasl/status` and `POST /api/local-wlasl/predict` after plugin wiring.
- POST raw video, <=40 MiB, video Content-Type, `X-SignBridge-Local: 1` header.
- One inference at a time, bounded output, 120-second timeout, cancellation kills only the owned subprocess.
- Temporary uploads in ignored `.training-data/wlasl-requests`, deleted on completion/error.
- Block direct static or `/@fs` access to request files. Watcher ignore is not an access-control rule.
- Available status includes ASL, actual labels, model name, calibrated:false. Unavailable status should produce usable UI fallback (current middleware uses 503).
- Prediction status is `review`, editable `suggestion`, top candidates and timing; **not a calibrated accepted translation**.
- Existing new UI supports upload or explicit camera recording, automatic finish at 12 seconds, explicit Analyze, editable text and explicit Speak. It deliberately does not auto-speak uncalibrated guesses.
- The pixel-based I3D path operates on actual video frames, independently of pose/shoulder capture gates; that alone does not establish better accuracy. The current checkpoint adapter is BGR, while the separate new trainer uses RGB.
- Keep this private GPU path out of public-demo builds and Render unless a separate deployment/privacy/resource design is explicitly implemented.

## 10. Corrected WLASL training path — prepared, not trained

`code/I3D/train_signbridge.py` is a separate trainer; it does not overwrite `train_i3d.py` or the old checkpoint.

- Official train/validation/test partitions retained separately.
- Training gradients use train only; checkpoint selection uses validation; this script leaves test untouched.
- Availability manifest records missing files/classes.
- `signbridge_i3d.py` contract `signbridge-i3d-rgb-v1`: BGR decode → RGB, aspect-preserving short side 256, 224 crop, uniform 64 samples, [-1,1], **mean temporal logits**. Train uses crop/flip augmentation, validation deterministic center crop. These augmentations still need linguistic suitability review for the chosen dataset/task.
- New checkpoint format `signbridge-i3d-checkpoint-v1` saves model/optimizer/scheduler/scaler/RNG, labels, preprocessing, data identity, provenance and metrics.
- Resume rejects wrong formats/contracts; old bare state dictionaries are not interchangeable full resumes.
- Defaults: 20 epochs, max four hours checked at epoch boundary, batch 2, accumulation 3, two workers, CUDA AMP when available. These are budget bounds, not guarantees of training time or accuracy.
- Outputs `last.pt`, validation-selected `best.pt`, `manifest.json`, `config.json`, `metrics.jsonl` to the chosen output directory.
- **No new trained checkpoint from this trainer exists at handoff. No new training was started during the documentation audit.**

Do not run training until the preprocessing, availability, labels, budget and evaluation design are checked. More epochs on a wrong pipeline or wrong labels cannot provide a truthful demo. Report top-one, top-five, per-class coverage, rejected/unsupported behavior and latency separately. A 100-class softmax is forced to choose something unless rejection is designed and evaluated.

## 11. Original skeleton/graph idea and prior research

The user proposed training joint-connected graphs instead of thousands of full images. That is a legitimate representation direction, already explored in the repo. Hand/body trajectories can reduce data size, but missing fingers, occlusion, timing, face/body grammar, handedness and camera geometry still matter. Joint tracking alone does not contain a reliable word label.

Do not discard the existing pose path simply because I3D exists. They are different experiments which need comparable evaluation, not interchangeable checkpoints.

Historical findings:

- A camera-aligned archived-pose candidate improved examined top-one accuracy from 75.00% to 93.23%, but falsely accepted 18% of unsupported recordings and failed the selected raw HELLO replay. It was not promoted.
- The 13 October current-detector study used 60 INCLUDE videos, actual browser pose extraction and two frozen candidates. Candidate B accepted 1 of 2 HELLO test videos, only 2 of 8 known test videos overall, and falsely accepted 2 of 6 unsupported test videos. Candidate A also failed requirements. Neither replaced the app model.
- Those tests have been examined; do not reuse them as a fresh blind test or tune repeatedly against them.
- Signer identity is not established for every legacy sample. Do not claim signer-independent performance without a verified grouped split.
- Training Studio exports include capture provenance. Mixed or partial context can block import intentionally. Do not delete metadata or invent dimensions to bypass that gate.

Detailed frozen evidence is in `docs/camera-training-results-2026-10-11.md`, `docs/tasks-video-training-results-2026-10-13.md`, their protocol/JSON companions, and ignored `training/artifacts/`.

## 12. Human communication and deployment contract

The accepted software-first plan was: connect people → add live video/voice → connect chosen input/output → accessibility/reliability. Preserve its foundations:

- Two participants maximum, opaque invitation, participant credentials for reconnect.
- In-memory history of latest 200 messages; room expiry after 30 minutes empty.
- Separate retained message IDs prevent duplicate retries; server assigns identity/order.
- Room restart means old room ended; unsent drafts should remain usable.
- Default camera/mic off; typed communication remains usable on media denial/failure.
- Share/borrow camera ownership appropriately; leaving/end releases tracks; recognition stop must not break an unrelated active call.
- Do not let dictation transcribe the app's read-aloud output.
- Preferences are per device and changes preserve conversation history.
- Optional read-aloud and screen-reader paths must not duplicate announcements.
- Live signing video is useful for fluent signers but does not translate signs for a non-signer.
- Saved reply clips are browser-local; an absent clip must be reported, not replaced by an invented sign or silently omitted negation.

Public pilot was verified on 8 October with synthetic remote HTTPS/WSS clients: 20 alternating messages, IDs/order/receipts, reconnect and invalid/third-participant rejection. Browser text send also worked. This was not two real devices on different networks and did not prove video relay or sign recognition.

Render configuration currently specifies Free, `npm ci --include=dev && npm run build:public`, `npm start`, `/api/health`, auto-deploy off. Old successful deployment was `361a131` after a missing-dev-dependency build correction. Current public health was not rechecked during this handoff.

TURN was historically unavailable (`relayAvailable:false`). Private Metered free-account setup and physical forced-relay trial were pending. Verify current state before making a claim. Never put TURN or Gemini credentials in a `VITE_` variable.

## 13. Commands and safe startup

Run commands in the indicated working directory. Paths use the current F: location. Commands below are instructions, not claims that they have just run.

### Start/stop local app

```powershell
Set-Location 'F:\Downloads\signbridge'
git status --short
node --version
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -NoBrowser
```

Then open `http://127.0.0.1:5174/#trained-sign` or `/#connect`. Double-click `start-signbridge.cmd` is also supported. The launcher resolves its own directory, starts hidden owned processes, records ownership and logs under `logs/local`, and checks health. It does not need a globally installed Vite.

```powershell
Set-Location 'F:\Downloads\signbridge'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -Stop
```

This stops only processes recorded/validated as launcher-owned. Do not kill every Node/Python process on the laptop. If dependencies are genuinely absent, use the existing lockfile with `npm ci`; do not overwrite env files.

### Local WLASL status and known failing development case

```powershell
Set-Location 'F:\Downloads\signbridge'
& 'C:\Users\adjay\Projects\WLASL\.venv\Scripts\python.exe' scripts/wlasl_infer.py --root 'C:\Users\adjay\Projects\WLASL' --status
& 'C:\Users\adjay\Projects\WLASL\.venv\Scripts\python.exe' scripts/wlasl_infer.py --root 'C:\Users\adjay\Projects\WLASL' --video 'C:\Users\adjay\Projects\WLASL\start_kit\videos\70212.mp4'
```

The second is BOOK development replay and has previously failed. Neither a filename nor an expected answer may enter the predictor. The first reports file/checkpoint availability, not prediction correctness or HTTP integration.

### Focused and full app verification

```powershell
Set-Location 'F:\Downloads\signbridge'
node --test tests/localWlaslMiddleware.test.js
npx vitest run --config vitest.config.js tests/ui/wlaslVideo.test.jsx tests/ui/automaticTrainedSign.test.jsx tests/ui/videoSignWorkspace.test.jsx tests/ui/signVideoInput.test.jsx
npm run check
.training-venv/Scripts/python.exe -B -m unittest discover -s training -p 'test_*.py'
npm run build:public
```

Run the public build **last** if producing distributable `dist`; confirm `dist/models` is absent. An ordinary local build can include ignored local research models. Do not deploy that directory accidentally.

### WLASL trainer inspection/tests

```powershell
Set-Location 'C:\Users\adjay\Projects\WLASL\code\I3D'
& '..\..\.venv\Scripts\python.exe' -B -m unittest test_signbridge_training.py
& '..\..\.venv\Scripts\python.exe' train_signbridge.py --help
& '..\..\.venv\Scripts\python.exe' train_signbridge.py --root 'C:\Users\adjay\Projects\WLASL\start_kit\videos' --audit-only
```

**Important CLI distinction:** `train_signbridge.py --root` means the **videos directory**; `scripts/wlasl_infer.py --root` means the **whole WLASL project directory**. The trainer defaults to `data/WLASL2000`; on this laptop that path is a junction to `start_kit/videos`. Supplying the actual videos path explicitly makes the command clear and portable if the junction changes.

Read `--help` and confirm output/budget before a fitting run. Keep new outputs in a new experiment directory. Never label an old bare checkpoint as a valid full resume of this new trainer. A future bounded run could use the following command, but **it has not been launched**:

```powershell
Set-Location 'C:\Users\adjay\Projects\WLASL\code\I3D'
& '..\..\.venv\Scripts\python.exe' train_signbridge.py --root 'C:\Users\adjay\Projects\WLASL\start_kit\videos' --output 'C:\Users\adjay\Projects\WLASL\code\I3D\checkpoints\signbridge_rgb_v1' --device cuda --epochs 20 --max-hours 4
```

Reinspect that output directory before running; select a fresh experiment path if it becomes nonempty. The training duration is unknown until measured and the time budget is checked between epochs.

### Environment variable names only

See `.env.example`: `PORT`, `ROOM_ALLOWED_ORIGINS`, `METERED_DOMAIN`, `METERED_TURN_API_KEY`, optional public `VITE_ROOM_SERVER_URL`, `GEMINI_API_KEY`, optional Gemini model/thinking settings, `ALLOWED_ORIGINS`. Local WLASL middleware also supports `SIGNBRIDGE_WLASL_ROOT`.

Do not ask the user to paste key values. Local speech and human-room text do not need Gemini. Model IDs in old comments/examples are not guarantees of current provider availability.

## 14. Recommended next execution order

1. **Reproduce the current state.** Read the companion history/inventory, inspect dirty files, run focused failing tests and verify exact checkpoint hashes. Keep a report of the baseline failures.
2. **Keep the known ISL demonstration available.** Start local services; verify the existing HELLO reference through the actual browser path. Distinguish known-reference output from webcam success. Do not retrain or replace it just to add WLASL.
3. **Repair WLASL preprocessing before claiming results.** Match official evaluation, test actual video decoding/tensor dimensions/channel order/temporal aggregation, use a declared development set and record wrong guesses too. Fix Python/Node model-name compatibility and response tests.
4. **Finish the local UI/backend route.** Add the route/import/entry point and dev-only middleware registration. Public build must not expose the local GPU model or private upload directory. Handle unavailable model, denied camera, abort, timeout and malformed files.
5. **Fix the two known regression failures.** Diagnose socket reset and leftover timer; assert cancellation cleans up owned resources and old callbacks cannot overwrite a new result.
6. **Show an actual result.** Record an actual supported ASL clip outcome through the browser → local Python → editable text → explicit speech flow. Do not auto-speak uncalibrated top-one guesses. If the checkpoint still fails, report it and continue diagnosis rather than inventing a passing demo.
7. **Improve the exact desired camera interaction.** Use consistent framing/complete signs, measured capture diagnostics and a supported vocabulary. Evaluate optional accepted-word auto-append with duplicate protection. Distinguish a sign and an explicitly labelled simple hand gesture.
8. **Only then train a declared candidate if needed.** Use the separate corrected trainer, clean splits, fixed budgets, real negative/unknown examples where available and a new evaluation design. A short smoke run validates engineering only; it is not an accuracy result.
9. **Validate the conversation end to end.** Sender sign → reviewed message → receiver text and voice; receiver speech/type → text and available verified sign reply. Preserve missing-clip gaps. Then physical two-device and cross-network tests.
10. **Finish with evidence.** State files changed, tests passed/failed, actual clip/word outcomes, model/data versions, local URL, what the user should click and what still does not work. Do not stop at a plan when an implementation task is active.

## 15. Acceptance checks and non-negotiable reporting

For a candidate release, separate these categories:

- **Engineering tests:** route, data contracts, validation, cancellation, media cleanup, message deduplication, speech invocation and public-build exclusions.
- **Known-reference demonstration:** a named already examined recording produces the intended text; browser speech status measured.
- **Recognition evaluation:** declared held-out data with verified labels, no training leakage, per-class counts, correct acceptance/coverage, wrong acceptance, unknown rejection and runtime.
- **Live user trial:** real laptop camera, actual signing, meaning review and a user confirms whether voice was audible.
- **Communication trial:** two people/devices understand the exchanged meanings, including reverse sign-video coverage and error recovery.

Do not conflate these. A mocked HELLO fixture, a top-one score, a classifier output from a file named HELLO, or a screenshot of joints is not recognition accuracy.

Specific regressions to cover: held hand vs movement, missing shoulders, clipped wrist, camera denial/busy/dark, language/model changes, blank/unsupported/incomplete signs, deliberate repeated signs, stale result after failure, no duplicate append/voice, no AI requests during human communication, draft preservation, absent reply clips, aborted requests and temporary-file cleanup.

The honest aim is a useful, clearly bounded working prototype. Do not promise all signs, fluent sentence translation, universal text-to-sign output, guaranteed novelty, a 10/10 product, or a trained replacement until measured evidence supports it.

## 16. Key reports to read selectively

Relative to `F:\Downloads\signbridge\docs`:

- `current-capabilities-2026-10-13.md` — broad capability/limitation snapshot, older than this handoff.
- `sign-video-to-text-voice-2026-10-22.md` and JSON/JPG evidence — actual HELLO video result.
- `capture-context-2026-10-22.md` — path move, metadata and training-input contract.
- `camera-training-results-2026-10-11.md` — archived-pose improvement which failed other checks.
- `tasks-video-training-results-2026-10-13.md` and protocol/metrics files — both failed candidate studies.
- `automatic-sign-capture-2026-10-11.md` — capture design; compare with current source.
- `external-lstm-full-analysis-2026-10-08.md` — AvishakeAdhikary repository review.
- `isl-reference-improvements-2026-10-09.md` — farihaNaqvi reference review and implemented workflow changes.
- `temporal-lstm-control-2026-10-08.md` — LSTM comparison and coordinate prerequisites.
- `communication-usability-review-2026-10-08.md` — low-reading-fluency barriers.
- `deep-implementation-plan-2026-10-10.md`, `two-way-communication-2026-10-09.md` — intended architecture and missing reverse direction.
- `render-pilot-verification-2026-10-08.md`, `conversations-deployment.md`, `local-demo-startup.md` — deployment/startup and physical-device gates.

Older documents may describe unfinished proposals or older source, so verify current code. Do not rewrite frozen scientific reports just to repair old absolute paths or improve their results.

## 17. First reply and action expected from Argon

Tell the user briefly, in simple Tanglish, what is actually working and what you will fix first. Then inspect/run the project. Do not ask for the folder again: it is `F:\Downloads\signbridge`, with WLASL at `C:\Users\adjay\Projects\WLASL`.

Suggested initial statement:

> “Macha, context purinjiduchu. Known HELLO video flow already irukku; live webcam recognition innum reliable illa. WLASL files ready, aana integration/preprocessing bugs irukku. First adhai reproduce panni, correct supported sign video → text → voice result browser-la kaatturen. Pass aagadhadhai pass-nu solla maatten.”

If you do not have filesystem/terminal/browser access, say precisely which access is missing. Do not pretend that this document's historical observations are actions you just performed. If operating in the laptop environment, continue the actual work within the user's requested scope.

---

**Short instruction to paste alongside this file:**

“Read this entire SignBridge master prompt, its detailed history and verified-state companion. Continue the existing local app at F:\Downloads\signbridge using C:\Users\adjay\Projects\WLASL where appropriate. Preserve dirty work and secrets. Fix the documented incomplete integration and reproduce real sign-video → text/voice behavior. Keep ISL/ASL and measured results separate. I want working, visible results, not another generic plan or hardcoded HELLO.”
