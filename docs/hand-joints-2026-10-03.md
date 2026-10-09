# Hand-joint recognition preview — 3 October 2026

The camera pipeline already supplied 21 MediaPipe landmarks for each hand. This update makes those landmarks easier to see and separates hand tracking from the availability of local sign-word weights.

## Behavior

- Connect has an explicit **Enable hand-joint tracking and word recognition** switch. It borrows the existing call camera; it does not request a second stream.
- The preview shows the wrist, each finger chain and fingertips in separate colours. Optional numbers identify landmarks 0–20. Labels remain readable in the mirrored preview; inference coordinates remain unmirrored.
- Live counts show left/right 0 or 21 landmarks and a total up to 42. Incomplete, sparse, nonfinite or absent hands are excluded. Counts refer to estimated landmark geometry, not language accuracy or verified visibility of every physical joint.
- Hand tracking runs while the sign-word model is loading or unavailable. Missing public-demo sign-word weights leave the joint preview and live conversation usable; they still prevent word inference.
- Paused Connect frames show **Paused** rather than presenting old joint counts as live. Camera/tracker shutdown clears the displayed counts. Retry, cancelled capture, review and explicit word speech remain available as before.
- Sign Workspace also allows explicit camera start without word weights and provides joint counts, labels and optional numbers.
- The static-sign adapter now rejects malformed hands and falls back to image landmarks when world landmarks are invalid.

The isolated-word GRU remains unchanged: it records the 75-landmark body/hand pose and uses its existing selected 27 joints (81 values per frame). This update does not retrain the model, alter its rejection thresholds or add continuous sentence translation. Hand geometry alone cannot establish a sign's meaning; the existing complete-word capture and review flow remains necessary.

## Verification

`npm run check` passed **204 Node tests + 214 UI tests in 20 files = 418 application tests**, followed by a successful production/PWA build. `npm run build:public` also passed, leaving the final demo build without local research sign-word artifacts.

New checks cover exact 42-joint drawing coordinates, finger colours, readable mirrored numbering, missing/malformed hands, invalid world-landmark fallback, camera start and tracking without sign-word weights, counts during loading, per-hand counts, paused/camera-off state and explicit activation without changing the message draft or sending it.

Actual updated camera overlays and known-word signing accuracy remain unverified: the browser-inspection tool is blocked by its security policy. No alternate browser or indirect browser commands were used to bypass that restriction. Automated camera/tracker fixtures are separate from real-device trials.

## Try on the laptop

1. Open `http://127.0.0.1:5174/#connect` and refresh to load the new controls.
2. Choose **Sign**, turn the camera on, then enable **hand-joint tracking and word recognition**.
3. Keep the signing hand and shoulders in view. The larger preview should show coloured finger lines and left/right counts; enable **Show joint numbers (0–20)** if desired.
4. When the local word model and framing are ready, choose a supported word, **Capture a word**, perform its complete movement, then **Finish sign**.
5. Review/correct the meaning. Choose **Speak reviewed word** for local voice or add it to the draft and choose **Send**.

Tracking needs its MediaPipe runtime/model to be available. A failed tracker shows a retry action; typing and live camera conversation remain independent.
