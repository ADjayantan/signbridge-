# Beginner workflow — 5 October 2026

## User report

The user reported that BOOK was not detected and that the site was difficult to navigate. This is a failed user trial, without a captured recording, measured report or fluent review. The changes below address discoverability. They do not establish a recognition fix or new model accuracy.

## Changes

- Home keeps Start/Join conversation together and adds a visible **Sign to text & voice** shortcut under **Quick tools**. Training Studio, saved sign videos and experimental video practice are under **More tools**. Keyboard S/V navigation and install controls remain available.
- The sign page follows **1 Sign → 2 Check → 3 Text & voice**. The three navigation buttons focus the matching section. Camera controls precede the preview so starting, finishing and ending a turn are easier to find.
- Finish focuses the result heading. **Add word to message** focuses the message field. A newly rejected capture returns the guide to Check even if an older message remains in the draft. The result remains tentative and editable.
- **Speak this word**, **Speak my message**, **Stop speech**, Undo and Clear are primary controls. Stopping speech does not clear the message or stop the camera. Typing remains usable when the camera or model is unavailable.
- **Supported words**, **More result options**, **AI replies (optional)** and **Advanced settings** use native closed disclosures. Word-model settings, evaluation, training consent and diagnostics remain accessible when needed. Closing a disclosure does not unmount its contents or the camera video element.
- AI sends remain explicit. A pending reply has a visible Interrupt control outside the optional AI section. Default recognition does not automatically speak or send an AI request. Automatic accepted-word speech remains an explicit advanced opt-in.
- Language warnings describe the existing page reset: changing either language stops the camera and clears the tool's draft, results and AI conversation. Camera errors, model errors, tracking retry and capture cancellation remain outside the optional disclosures.
- Layout styles are scoped to Home and the sign workspace. Narrow screens retain one-column content and the three navigation controls. No new runtime dependencies, fonts or model artifacts were added.

## Recognition boundary

BOOK is present in the local ASL model, but a loaded vocabulary entry does not guarantee correct webcam detection. Model weights, preprocessing, thresholds and release gates were not changed. No expected word is forced into the prediction, no alternative gesture shortcut is substituted, and manually entering or choosing BOOK is not counted as model recognition.

The local research models still recognize isolated words only. Continuous sign-language translation, fluent validation and reliable unfamiliar-signer recognition remain unfinished. The earlier DRINK failure remains a user report too. Historical dataset results are separate from these device trials.

## Verification

- `npm run check` passed **244 Node + 281 UI = 525 application tests**, followed by the production build and PWA generation. The focused Home/workspace/freshness run passed **53 tests**. New coverage checks closed disclosures, core controls, workflow focus/current-step transitions, camera-denial typing and voice, preserved camera/drafts, visible Stop speech, and interrupting pending AI with its settings collapsed.
- `npm run build:public` passed. The final `dist` has no `models` directory or `.onnx`, `.pt`, `.npz`, `.pkl` or `.pickle` research artifacts. The generated worker retains `NetworkOnly` handling and has no automatic `clientsClaim`.
- Whitespace checks passed. Room health at port 3001 and Vite's health proxy at 5174 returned HTTP 200 with `{"ok":true}`. The local site root returned HEAD 200. The local servers were restarted after discovering they had stopped.
- The sign page open request was queued by the app; that response does not confirm visible rendering. Tests simulate camera, speech and AI interfaces. Actual browser rendering, narrow-screen layout, keyboard/screen-reader device operation, audible output, installed-PWA activation and live BOOK recognition remain unverified for this layout. No browser-policy workaround was used.
- No new model training or Python-suite run was required for this UI change. No model was promoted and no recognition threshold was lowered.

## Device walkthrough

1. Open Home and choose **Sign to text & voice**. Choose the sign language before creating a draft.
2. Press **Start camera**, keep both shoulders and signing hands visible, and wait for fresh tracking frames. Press **Capture a sign**, complete one sign, then **Finish sign**.
3. Check the tentative result. If it is wrong or rejected, retry or explicitly type the intended word. Open **More result options → Why this result?** for diagnostics and an optional local report.
4. Press **Add word to message**, review the message and press **Speak my message**. **Stop speech** should stop playback while preserving the text and camera.
5. Test typing after denying camera access. Toggle optional sections and verify that the message and camera preview stay intact. On a narrow screen, confirm the controls remain readable and keyboard focus reaches every action.

Record recognition results and manually corrected messages separately. A successful speech action does not make a failed prediction successful.
