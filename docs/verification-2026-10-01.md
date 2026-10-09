# SignBridge verification — 1 October 2026

The available core and UI regression suites pass: **95 Node tests + 70 Vitest tests = 165 app tests**, plus **25 Python training checks**. Production build and PWA generation pass. This verifies application behavior within the conditions below; it does not measure full ISL/ASL translation accuracy. The newly trained isolated-word models have separate dataset evaluation: **75.0% ISL / 40.8% ASL top-1**, with important rejection and signer limits in [the training report](model-training-2026-10-01.md). See [the repeatable real-time test cases](realtime-test-cases.md) for browser checks and signer trials.

Environment: Windows, Node 26.8.1, React 19.3, Vite 8.3.1. Development toolchain now requires Node 22.12 or newer. Browser checks ran on localhost using the Codex in-app Chromium browser.

| Feature | Evidence | Result / limit |
| --- | --- | --- |
| Trained ISL / ASL words | Actual public pose datasets, PyTorch training and held-out clips | 49 ISL / 100 ASL classes; test top-1 75.0% / 40.8%. Not a continuous translator or unseen-signer/live-camera accuracy result. |
| Exported model correctness | Real held-out probability and raw-pose comparisons | Both browser GRUs match PyTorch and preprocessing within 1e-5. All split clip IDs are disjoint. |
| Trained mode laptop workflow | Actual browser and Integrated Camera | Both local models loaded. Holistic started on a playing 640×480 stream. A hand-free capture returned no signing and disabled speech; Cancel returned to ready; End reset video to readyState 0 and 0×0. No signed footage was uploaded or saved. |
| Live Sign session | React tests and actual browser navigation | Camera starts with session; capture, preview, meaning review, chat, interruption and next-turn states are implemented. ISL/ASL selection is separate; changing language remounts the session. |
| Live video interpretation | Server/client tests with mocked Gemini | Video bytes reach inline data with 8 FPS sampling and selected language. Missing consent, wrong MIME/language, invalid duration and oversized requests fail. No live signing interpretation was performed because no Gemini key is configured. |
| Meaning confirmation and history | React tests with recognized/unclear results | Answers wait for confirmed or typed meaning; uncertain meanings are blank. Completed turns enter context; interrupted/failed turns do not. Failed sends retain meaning for retry. |
| Live turn recording | Real Integrated Camera in the browser; simulated failure tests | A 640×480 camera turn stopped at 12 seconds and decoded in the review player (readyState 4, no decoder error). Camera recordings use video-only MediaStream; real sign accuracy/audible speech not tested. |
| Live imported clip | Actual synthetic 1-second MP4 | ASL session accepted a playable short file and displayed its preview with fresh unchecked consent. No footage was sent to Gemini, persisted on the server or saved as a library clip. |
| Live cancellation and privacy boundary | React tests and actual End session UI | End/interrupt cancels owned recorder/request/speech; late responses and recordings are ignored. Fresh clips require fresh consent. Recorded draft disappears after End and the camera video returns to readyState 0 with 0×0 dimensions. Native track release is also covered by hook lifecycle tests; the automation DOM scope does not expose MediaStream objects. |
| Live server readiness and size cap | Actual localhost HTTP checks and Node tests | GET status returned configured:false without inference. A request over 3 MB received HTTP 413 from the running Vite middleware. A configured flag alone is not an inference health check. |
| Held sign → words and speech request | React test uses real decision/smoother with simulated MediaPipe frames | Held signs commit/speak once; duplicate holds stay locked. Audible output not verified. |
| Careful recognition | Core and React tests | Longer hold, stricter score and frame-edge rejection pass. Scores are not accuracy measurements. |
| Review, edit, auto-send | React tests | Edits disarm auto-send; a new held sign can send once after the configured hands-down interval. |
| AI sign request and retry | Mock upstream tests; actual local browser missing-key response | Validation/errors pass; failed sends restore words. No live Gemini key was configured. |
| Face-to-face bridge | React tests and local browser checks | Reviewed words request speech; typed partner replies become text/video lookup without AI. Microphone error discards partial text. Real transcription is unverified. |
| Voice streaming and hands-free | Node/React tests with simulated stream/speech | Partial final JSON, truncated streams, cancellation, stale EOF, successful restart and failure recovery pass. |
| Speech cancellation | Simulated browser speech engine | Queued promises settle, watchdogs clear, stale recognition callbacks are ignored, synchronous speech failures release the queue. |
| Video dictionary storage | IndexedDB tests; actual browser import/save/delete | Blobs survive storage; duplicate phrases cannot overwrite silently; size/type validation passes. |
| Imported video validation | Actual playable MP4 and intentionally damaged MP4 | Save stays disabled until frames decode; corrupt video is rejected. |
| Dictionary recording lifecycle | Simulated MediaRecorder and live/ended tracks | Browser stop clears timer; lost camera during countdown cancels; empty recordings fail. The dictionary recorder's actual human-signing content still needs user testing; Live Sign uses a separate recorder verified above. |
| Reply video playback | React tests and actual MP4 decoding | Next clip uses the correct URL; repeated clips restart; missing words remain visible and pause playback; speed/replay controls available. |
| ISL/ASL and reply-language separation | Core/React tests; browser switch/remount | Dictionaries do not cross-match; older replies keep their original speech language; mislabeled training imports fail. |
| Teach signs | Classifier tests and UI import tests | Feature matching, mirroring, persistence, legacy ISL import, ASL mismatch and malformed metadata checks pass. Live human training still needs a signer. |
| Camera lifetime | Simulated browser getUserMedia | Late permission result after unmount releases tracks; permission errors provide retry instructions. |
| Laptop webcam access | Windows device inventory; actual browser stream; regression tests | The original default was Redmi Note 10 Pro Max (Windows Virtual Camera). Automatic selection now prefers Integrated Camera (04f2:b7b9), which the browser reported connected with a playing 640×480 video (readyState 4) and active hand tracking. A picker allows explicit overrides. Earlier placeholder output came from the phone virtual camera, rather than proving that the in-app browser could not use a laptop webcam. |
| Tracking runtime / fallback | Simulated GPU slowness/failures; actual production MediaPipe | GPU→CPU fallback and failure cleanup pass; actual runtime processed the synthetic video. This is not a hand/sign accuracy test. |
| Offline app, model and video playback | Production PWA + tab-scoped network emulation, reload | App reloaded offline; previously cached runtime/model loaded and processed local video; saved repeated clips played to completion. First-use downloads still require internet. |

## Fixes and enhancements

- Fixed the reproduced Vite **aborted** overlay: cancelled HTTP uploads and disconnected response streams now terminate cleanly in the shared dev/preview adapter, while genuine errors still reach error handling. Three actual cancelled uploads left the running dev server healthy, and the reloaded browser had no error overlay. Excluded the 22,000-file Python environment and training data from the development watcher. Also fixed the SDK's default zero hand visibility being mistaken for missing hands. See [the cancellation bug report](aborted-error-2026-10-01.md).
- Added a dedicated Live Sign route and conversation interface, with real short-video API plumbing, explicit per-clip sharing choice, reviewed meaning, optional speech, saved-video replies and retained completed chat context. The original local tools remain available.
- Added video-only recording limits, disconnected-camera retry, strict interpretation parsing and streamed request size limits. Interrupted video/AI work cannot overwrite later turns or produce speech.
- Fixed a reproduced import race: Space could start recording while a replacement video was being decoded. Keyboard capture, typed sends, interpretation and confirmation now wait for import inspection. Four new regressions cover action blocking, draft preservation, consent reset and late-import suppression.
- Fixed misleading HELLO fallback: gesture shortcuts are now opt-in, since an open palm inside an unknown sign could otherwise become HELLO. The camera panel lists actual saved vocabulary and explains unknown matches. A disabled gesture on one hand no longer masks another enabled gesture. Tests confirm distinct shortcut words and saved WATER/HELP handshapes request speech; this uses synthetic landmarks and a mocked speech engine, not a real-sign accuracy measurement. The current ISL browser had zero saved signs, and Live Sign still had no AI key configured.

- Interrupted voice replies are marked interrupted instead of leaving a pending row; stale streams cannot overwrite them. Truncated/malformed AI responses produce readable failures.
- Stopping speech clears queued work and timers; aborted/error microphone sessions cannot submit unreliable results.
- Recorder stop and countdown recovery are reliable. A playable preview is required before saving a clip, and submitting the same playback phrase starts it again.
- Video transitions never play the previous clip under a new word; repeated clips restart. Uploaded recognition uses video time for hold duration, so pausing does not count as holding a sign.
- Source-video errors appear beside the video in every tab. Tracking metrics reset on delegate changes and failures. Old replies preserve their language when spoken.
- Taught-sign imports validate language metadata and expose an accessible file-input label.
- Camera startup explains the Allow prompt; connected streams show their name. Camera-device selection prefers the integrated laptop camera over phone/virtual cameras, rechecks initially hidden device labels after permission, and respects explicit user choices. Both sign and voice modes have a picker.

## Remaining real-world validation

Live Gemini interpretation/answers need a server-side `GEMINI_API_KEY` in `.env.local`, followed by restarting the development server. Actual microphone transcription, installed-language voices and signing interpretation must be checked on the target device with consented footage. The new conversation flow and key-missing behavior were verified; upstream video compatibility, latency and real signing accuracy were not verified. ISL/ASL reply-video content needs fluent-signer review and recordings; no sign videos are bundled.

Personal-sign recognition supports saved static handshapes and opt-in gesture shortcuts. The new `/#trained-sign` route uses actual trained temporal word models locally. Live Sign continues to use experimental generic video interpretation. The word models need unseen-signer and laptop evaluation, especially improved ASL coverage; full sentence translation and fluent sign replies remain unfinished. Concatenating dictionary clips does not implement sign-language grammar. See [the training report](model-training-2026-10-01.md) and [Live Sign design](live-sign-design.md).

The videos named QAALPHA, QABETA and QAOFFLINE were synthetic disposable playback fixtures, not human signing. All were removed from their dictionaries after testing. Offline network emulation was disabled afterwards. No user signs or clips were deleted; no changes were deployed or pushed.

*Archived test capture omitted from this public source snapshot.*

*Archived test capture omitted from this public source snapshot.*
