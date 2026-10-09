# Capture readiness and genuine nonsigning examples — 5–8 October 2026

This update improves capture guidance and creates a local, model-independent collection path. It does not establish improved sign recognition, retrain a model or replace current experimental weights. BOOK and DRINK user failures remain unresolved.

## Capture guidance

The sign workspace now requires a fresh frame containing at least one complete detected hand and both shoulders before a word capture can start. Button and Space-key paths use the same requirement. The latest frame controls readiness rather than an older throttled preview; loss of framing during a recording still leaves Finish and Cancel available. The final measured-duration and simultaneous-visibility gate remains responsible for the whole turn.

A visible checklist distinguishes hands, shoulders and fresh tracking. One-hand signs are permitted. Hands near the camera edge produce guidance rather than a universal rejection. The interface explains that framing does not prove meaning, and prompts Capture just before the movement and Finish as it ends. This follows the [source/data diagnostic](recognition-capture-diagnostic-2026-10-05.md), which found no proven joint-order mismatch.

## Collect without knowing sign language

Open **Home → More tools → Training Studio**, then expand **Record no-sign examples · no sign-language knowledge needed**. The section starts closed and its camera starts only when selected.

1. Choose sitting still, everyday movement, or hands/body out of view. These instructions do not assign a sign word.
2. Choose **Start nonsigning camera** and wait for fresh tracker output. Hands and shoulders may be absent; tracker output must still arrive.
3. Choose **Record 3 seconds**. Review measured sample count, duration and tracking gaps. Missing or paused observations cannot become a saved example.
4. Enter an anonymous participant code. Confirm that no intentional sign was performed and separately consent to storing coordinates/timing. Choose **Save nonsigning example**.
5. Export explicitly from Training Studio when ready. The JSON contains poses, codes and labels; no video/audio is stored or uploaded.

No sign model, AI key or AI interpretation is required. Initial tracker assets still need to be available. Recordings are temporary until an explicit save; closing the section, changing language or leaving releases the camera and clears unsaved capture. A save already requested can commit while the section closes; the shared inventory reflects that completed write. No examples were collected from the user's real camera during implementation.

## Data boundaries

The existing v1 envelope is retained. An optional `negativeType` distinguishes `nonsigning`, `unsupported-sign` and `unspecified` on unknown samples. Old samples that omit the field remain unspecified; a failed prediction is not automatically labelled nonsigning. The normal training form allows an explicit subtype and resets consent when that choice changes. Known-word labels still require knowledgeable verification.

New nonsigning recordings also preserve `captureDurationMs`, the actual measured window, separately from the legacy `durationMs` sample span. Old exports keep the field absent rather than estimating it. A timer finishing late retains its real duration; the three-second sample window allows up to one second of completion delay only if every tracking gap still passes. Longer windows or gaps reject before saving. Malformed or sparse frames reject safely.

Both the browser storage validator and offline importer now require four known-sample frames with a hand and both shoulders visible together. They previously counted those observations separately. Invalid old known samples receive a recapture error rather than being rewritten. Unknown poses can retain missing body/hands.

The importer retains all explicitly tagged nonsigning recordings in a separate inventory, even when joints are visible. It does not mix them into existing model calibration arrays or synthesize features from empty poses. Unsupported signs continue through the existing eligible unknown holdouts; unreviewed legacy samples keep their previous path. Anonymous signer assignments, train/validation/test separation and incomplete-collection blocking remain enforced. Adding nonsigning records alone does not make a collection training-ready.

A future evaluation must declare how genuine nonsigning examples are used and report camera-gate behavior separately from classifier false acceptance. Collection alone does not establish a rejection rate or a fluent translation result.

## Verification

Final verification on 8 October: `npm run check` passed **595 application tests (275 Node / 320 UI)** followed by the production build. The full Python suite passed **145 tests**. `npm run build:public` passed afterward; no research model artifacts are included.

Regressions cover fresh one-hand/shoulder readiness, lost framing with Finish/Cancel retained, missing landmarks versus missing observations, malformed frames, actual delayed-timer duration, explicit attestation/consent, storage reload/retry, activity-change reset, duplicate/stale saves, camera cleanup, subtype inventory labels, legacy metadata omission, and export/import preservation. Python/Node parity tests verify that retained nonsigning records do not change existing prepared model arrays. No new training or model promotion occurred.

Media/UI checks simulate tracker frames and browser devices. Real camera recording, storage/download interactions and accessible device usability remain separate checks; no live-browser inspection was performed.
