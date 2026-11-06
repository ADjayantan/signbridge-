# Advisor demo: sign video → recognized text → voice

**10 October 2026. Local implementation and measured results.**

The working demonstration is a permitted HELLO reference video processed through the browser's actual body/hand tracker and unchanged local ISL GRU model. It produces HELLO text, and an explicit Read aloud action invokes browser speech. This is a limited isolated-word prototype. A successful webcam demonstration has **not** been established.

## Implemented

- The Sign Workspace now offers **Start camera + read aloud**. This explicitly enables voice after an accepted result; normal Start camera stays available. Capture a complete sign, then Finish. Rejected results remain silent.
- The voice switch and **Test speaker** are visible beside the camera. The speaker test says “Voice output is ready.” It does not pretend to recognize a sign.
- Sustained uniform dark camera frames show a clear warning and **Retry dark camera**. Dark frames block capture; a turn becoming dark is cancelled. Recovery requires fresh tracking. Typed text and explicit speech remain usable.
- **Reference video demo** is a collapsed local-only panel on the same page. Opening it releases the camera and clears its old word result while preserving the typed message. Starting the camera closes replay and cancels its tracker/playback/speech.
- The reference panel explicitly identifies its GRU model, independently of the workspace's model selection. **Read aloud predicted word** is available only for its accepted prediction. Supplied baseline labels cannot choose the recognized or spoken word.
- Language control wrapping and the camera retry button's text contrast were corrected after inspection in Chrome.
- Local startup helpers check actual HTTP readiness and include a matching Stop helper. See [startup verification and limits](C:/Users/adjay/Downloads/signbridge/docs/local-demo-startup.md).

No model weights, recognition thresholds or acceptance margins were changed for this demo. No AI answer request or room message was used.

## Browser evidence

| Check | Observed result |
| --- | --- |
| Local web and room server | HTTP 200, direct and proxied health `ok: true`. |
| HELLO reference replay, Codex browser | **Recognized HELLO**, 15 qualified samples, 2.0819 seconds; score 0.978941. The score is not an accuracy measure. |
| Matching offline baseline | Same video/model hashes; top label and accepted output agree. |
| Explicit read aloud of accepted HELLO | Native browser playback reached **“Reference-word playback finished.”** Audible sound at the laptop speaker is unconfirmed. |
| Chrome physical webcam | Uniform dark preview, no hand/shoulder joints; Capture disabled with the new warning. No physical HELLO recognition pass. |
| Camera retry | Clicking Retry dark camera returned to Connecting the camera. The physical dark-image cause is unresolved. |
| Screen layout | Language selector no longer overlaps its explanation; dark-camera retry label is readable. |

The actual downloaded scalar evidence is [hello-reference-replay-2026-10-10.json](C:/Users/adjay/Downloads/signbridge/docs/hello-reference-replay-2026-10-10.json). It contains no video, filenames or joint coordinates. The source clip is the existing local INCLUDE validation clip `Greetings/48. Hello/MVI_9917.MOV`; it is not a fresh final-test sample.

![Actual browser reference prediction and voice-completion status](C:/Users/adjay/Downloads/signbridge/docs/hello-reference-2026-10-10.jpg)

## Repeat the demo

1. Start the local app and open [Sign to text & voice](http://127.0.0.1:5174/#trained-sign). Use the normal local development server, which has the local research model.
2. Open **Reference video demo**. Choose the existing local clip at `C:\Users\adjay\Downloads\signbridge\.training-data\replay\isl-hello-validation-MVI_9917.MOV`.
3. Keep the default realtime camera path, Tasks tracker and normalized-image coordinates. The matching optional baseline is beside the clip: `isl-hello-validation-MVI_9917.camera-v2.baseline.json`.
4. Press **Run video through recognition** and keep the tab active. Show the actual result. If the run is rejected, show the rejection rather than changing settings to force HELLO.
5. Press **Read aloud predicted word**. Confirm that sound is heard; callback completion alone does not prove audible speaker output.
6. For a separate live-camera trial, close replay and choose **Start camera + read aloud**. First confirm a visible preview, hands and both shoulders. Then Capture → complete sign → Finish. Record the result even if rejected.

Chrome's extension file chooser needs its optional file-URL access setting for automated file selection. The verified reference run used the Codex browser without changing that Chrome permission.

## Automated verification

- `npm run check`: 324 Node tests, 456 UI tests and regular production build passed.
- After the last workspace/copy/layout adjustments, the three focused recognition/workspace suites passed (98 tests).
- `npm run build:public` passed last. Research model assets and the local reference panel are excluded from the public demo.
- The existing large JavaScript chunk warning remains. These tests do not establish physical-device translation accuracy.

## Research implementation next

Follow the [deep implementation plan](C:/Users/adjay/Downloads/signbridge/docs/deep-implementation-plan-2026-10-10.md): freeze sample provenance and evaluation partitions; produce canonical 75-joint data before another training run; compare matched temporal models; promote only measured improvements. The separate pose-to-text checkpoint lane still needs compatible samples, terms review and offline runtime/meaning evaluation. No new checkpoint was trained, downloaded or promoted here.

Complete sign-video replies, natural continuous translation and two-device different-network verification remain unfinished. This demo should be presented as reference isolated-word recognition with text and requested voice output.
