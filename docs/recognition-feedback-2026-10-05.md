# Recognition feedback and model identity — 5 October 2026

## Report and evidence

The user's corrected report is **DRINK was not detected; HELLO and STOP were detected**. It supersedes the earlier “DRINK correct” response. This is a user report, not a recorded or linguistically reviewed camera trial.

Inspection of the actual local JSON artifacts found:

| Artifact | Vocabulary | DRINK | HELLO | STOP | Score / margin threshold |
| --- | ---: | --- | --- | --- | --- |
| ISL | 49 words | Absent | Present | Absent | 0.95 / 0.30 |
| ASL | 100 words | Present | Absent | Absent | 0.98 / 0.30 |

Both current JSON model hashes still match the [3 October historical evaluation](model-evaluation-2026-10-03/summary.json). Its [DRINK row](model-evaluation-2026-10-03/known-words.csv) has 25 training, 5 validation and only 4 test examples: 2 were correctly accepted and 2 were rejected with CITY as the top suggestion. One [unknown TOMORROW example](model-evaluation-2026-10-03/unknown-words.csv) was falsely accepted as DRINK. These tiny archived samples, with signer overlap, establish neither stable per-word accuracy nor live-camera reliability.

The separate gesture shortcut path maps open palm to HELLO and closed fist to STOP. It does not translate ISL or ASL. The trained-word predictor returns only labels in its loaded artifact. STOP therefore cannot be a fresh prediction from either inspected trained-word artifact. A shortcut screen, previously cached app, or reviewed/edited text is a possible explanation; the user's visible screen and installed cache were not inspected, so the cause is not confirmed.

## Changes

- Sign Workspace and Connect's local recognition panel show the actual loaded language, vocabulary size and model type. A foreign-language artifact cannot claim a matching vocabulary.
- **Find a word in this model** checks the loaded labels before capture. Its query is private component state: it never enters recognition, a reviewed message, speech, training storage or a network request. Looking up DRINK does not force the next result to DRINK.
- **Why this result?** explains capture gates, disabled acceptance, low model score and insufficient separation. Diagnostics retain scalar measurements and never retain raw poses or mutable model references.
- A capture rejected before inference reports no measured model confidence. The compatibility `score: 0` remains unchanged but is not shown as a measured 0% posterior. Captured samples remain distinct from the 32 resampled model frames.
- The legacy model hook hides the previous language's ready state immediately during a language change, including the render before passive effects. Existing abort and late-response guards remain.
- A follow-up **Download recognition report** action inside **Why this result?** exports a fixed JSON schema with tentative artifact labels, scalar model scores, rejection reasons, capture counts/timing and the export time. It excludes reviewed text, vocabulary-search input, video/audio, joint coordinates, source-frame timestamps, room/signer/session IDs, keys and arbitrary objects. No report is created, stored or uploaded automatically. The download is separate from the Training Studio dataset and establishes no reviewed ground truth.
- Production PWA registration uses a waiting update notice and **Update and reload**. A waiting update or another tab's activation does not reload the current tab. The notice advises finishing the turn and copying unsent text before an explicit reload. No storage clearing, development-worker removal or automatic activation was added.

No model weights, preprocessing, rejection thresholds, acceptance decisions or automatic sentence translation were changed. The 75-joint candidates remain unpromoted. Workspace and Connect keep their independent per-device language preferences.

## Verification

- Initial diagnostics update: `npm run check` passed **239 Node tests + 255 UI tests = 494 application tests**, followed by a successful production build and PWA generation.
- Follow-up report export: the latest `npm run check` passed **244 Node tests + 264 UI tests = 508 application tests**, with production build/PWA generation passing. Five pure report tests and eight download tests cover explicit field whitelisting, no inferred posterior before inference, unavailable measurements, no automatic network/storage/speech, editable drafts, failure/retry and URL cleanup. A room integration regression checks measured capture quality, exclusion of reviewed text and no speech/message append.
- Focused Workspace/graph/diagnostics tests: 56 passing. They include rejected and differently accepted predictions after a DRINK vocabulary lookup, preservation of reviewed drafts, silent rejection, language freshness and camera-quality metadata propagation.
- The 7 PWA notice tests cover no waiting update, explicit activation, duplicate clicks, external activation, editable draft preservation and failed-action retry. Tests mock the registration API; they are not a browser service-worker activation trial.
- The installed registration implementation was inspected: the React hook forwards `onNeedReload`; the prompt controlling handler invokes it; requesting an update messages the waiting worker. The generated worker calls `skipWaiting` only in response to `SKIP_WAITING` and does not call `clientsClaim`.
- `npm run build:public`: passed. Final `dist` contains no `models` directory or `.onnx`, `.pt`, `.npz`, `.pkl` or `.pickle` research artifacts. Public model requests retain `NetworkOnly` caching, and public hooks retain their model-loading guards.
- Room server health and Vite's health proxy returned HTTP 200 with `{"ok":true}`. The local site root returned HEAD 200 at `http://127.0.0.1:5174/` after server restart. These are availability checks, not browser render/camera tests.
- This JavaScript-only change did not rerun model training or the separate Python suite. Its previous 115-check result is historical evidence.

## Remaining device checks

The subsequent [beginner workflow update](usability-2026-10-05.md) moves vocabulary lookup under **Supported words**, and diagnostics/report downloads under **More result options → Why this result?**. It records the user's later BOOK failure without changing models or claiming a recognition fix.

Refresh `/#trained-sign`, confirm **Loaded ASL word model**, look up DRINK, then deliberately **Start camera → Capture a sign → complete the movement → Finish sign** with both shoulders and the signing hand visible. Inspect the result and **Why this result?**. Record the tentative label or rejection, rather than counting a manually chosen suggestion as recognition success.

Use **Download recognition report** after Finish when diagnostics are present. The browser receives a local `signbridge-recognition-report.json` download request; saving the file depends on the browser's download settings. Download failure keeps reviewed text available, and temporary URLs are released after download, result replacement or unmount. The report includes scalar observations only and cannot reproduce or retrain the model from the signing movement.

Actual webcam recognition, audible output, actual browser report downloads, installed-PWA update activation and fluent-signer correctness are still unverified for this change. The ASL model rejects many known signs; presence in its vocabulary does not establish reliable DRINK recognition. A rejected turn does not prove the user's sign was wrong.
