# Hand recognition follow-up — 3 October 2026

The reported Connect screen had a playing camera preview but **Enable local word recognition was off**. Camera sharing and optional word recognition are separate controls. A raised hand alone does not start an isolated-word capture.

## Observed in the real browser before the later inspection block

- The user's existing room remained connected, waiting for a partner. Recognition was off and the reviewed draft was empty.
- Enabling recognition loaded the local ISL model with 49 supported words. MediaPipe body/hand tracking finished initialization and the Capture a word control became enabled.
- The borrowed laptop camera video decoded at 640×480, readyState 4, with playback active. No room-ending or camera-stop action was performed.
- No complete, labelled sign trial was performed. Tracker initialization is not a measurement of live word-recognition accuracy.

## Changes

- Connect now explicitly says when word recognition is off and explains how to enable and capture a complete supported word.
- Recognition shows a larger camera canvas with actual detected hand landmarks and the shoulder line. It uses the existing call video, without acquiring a second stream or recording/exporting footage.
- Idle detections now show hand count, shoulder visibility and camera-edge guidance. Capture becomes available after a fresh hand/shoulder detection; frames paused for over two seconds disable new captures and offer retry.
- Ordered instructions describe Capture → complete sign → Finish → Review → Add to message. Supported vocabulary is expandable, and active captures show sample counts and the 12-second time limit.
- Predictions still run only after Finish. Unknown/no-hand captures remain reviewable rejections, with no automatic word insertion or sending.
- Tracking cancels startup when disabled, closes a late-created task, skips paused/repeated video frames, and releases a failed task before retry. The shared camera tracks remain owned by the call.

## Verification

`npm run check` passed: **190 Node tests + 177 UI tests in 19 files = 367 passing tests**, with zero failures, followed by a successful production/PWA build.

`npm run build:public` passed last. The final `dist` has no models directory; both local source model files remain present for development.

New regressions cover explicit activation and draft preservation, idle framing without prediction, stale-frame readiness/retry, capture sample accounting/rejection, late task resolution/cancellation, repeated runtime failures and paused/repeated video frames.

The latest visual layout, landmark drawing and an actual known-word capture were **not verified in the browser**: after the session interruption, browser security policy blocked inspection of the localhost tab. No alternate browser or indirect browser-command workaround was used. The earlier real-camera observations above are kept separate from the mocked UI tests.

## Try it locally

1. Open the Connect screen, choose Sign and the intended ISL/ASL language, and turn on the camera.
2. Enable local word recognition. Keep the signing hand and both shoulders visible until Ready to capture a word appears.
3. Expand the supported vocabulary, choose a word, press Capture a word, perform its complete sign, then press Finish sign.
4. Review/correct the result and add it to the message before choosing Send.

The existing models remain experimental isolated-word models: 49 ISL and 100 ASL words. This change improves activation and tracking feedback; it does not retrain them or establish continuous sentence translation or new live accuracy. Public demo builds continue excluding the local research weights.
