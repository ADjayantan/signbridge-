# Partner translation and sign AI — 5 October 2026

## Product outcome

A person who signs should be able to communicate with someone who does not know that sign language. The same reviewed meaning can also be used to talk to an AI assistant. The conversation destination determines what happens to the message: a partner receives it, while an AI assistant answers it. Disability categories are not used to organize people.

The shared boundary is **camera movement → tentative meaning → review → explicit delivery**. A successful send, grammatical AI reply or spoken manually edited word does not prove that the sign was correctly recognized. Natural continuous translation remains unfinished.

## Current implementation work

### Clear destination

Home exposes a sign AI entry alongside the local sign-to-text/voice tool. The sign page keeps the same camera and editable message while switching between **Text & voice** and **AI assistant**. Opening the AI reply section is an explicit choice; merely capturing a sign does not send it. A pending AI reply can be interrupted, and selecting local text/voice retains the draft while cancelling pending AI work.

**Talk to a partner** opens the existing room flow and stops the local camera. Reviewed text can be copied into an empty room draft. An existing room draft is preserved until the user explicitly adds or replaces it; an overflow keeps both texts available. Copied text remains editable and is not sent or spoken automatically. Human rooms retain their independent preferences and explicit message controls.

This is route integration around existing rooms and assistant hooks, not a continuously connected sign interpreter. Research weights are still absent from public demo builds.

### Camera-quality defect

The legacy predictor checked hand and shoulder sample counts independently and did not use actual capture duration. A synthetic capture with disjoint hand-visible and shoulder-visible frames could reach inference, as could a capture with a long final tracking gap.

The camera-only wrapper now reuses the established turn gate: four to one hundred strictly ordered measured samples, duration from 0.35 to 12 seconds, at least four samples with hands and shoulders visible together, and no start/internal/end tracking gap over one second. Camera duration must be supplied rather than invented from the last sample. Rejected captures expose scalar reasons, no label, and no measured model confidence.

The archive predictor, numerical preprocessing, learned weights and deployed rejection thresholds remain unchanged. This prevents bad camera captures reaching word inference; it does not establish a BOOK or DRINK recognition improvement.

### Fixed vocabulary research pilot

The completed bounded experiment used the existing strict ASL signer groups and training-only support to select twelve labels. It compared the same full-joint temporal architecture with and without mild spatial augmentation across three fixed seeds. Missing landmarks and confidence masks stayed unchanged; there was no mirroring, time reversal, artificial signing ground truth or live-data collection.

Calibration keeps genuine unknown signs and excluded known-vocabulary signs as separate negative groups. A research screen requires at least 95% accepted-known precision, at least 60% correctly accepted known coverage and at most 5% false acceptance in each negative group. The augmented arm also needs a declared improvement over its matched baseline. These are reused validation/model-selection results, not untouched test, live accuracy or release evidence.

All six runs failed the fixed gates. Across the three seeds, average macro recall increased from 64.95% to 71.53%, while correctly accepted coverage remained 1.71% for both arms, far below the required 60%. DRINK was correctly accepted on zero of its five validation clips in every run. BOOK had four validation clips and remains unreliable. These small reused samples do not establish live-camera performance. See the [frozen protocol, results and limitations](recognition-pilot-2026-10-05/README.md).

No candidate was exported or promoted. A passed validation screen would still need independent final evidence, runtime parity/performance, allowed artifact distribution and fluent device trials. A failed screen remains a useful measured outcome, not permission to force expected words into predictions.

## Remaining programme

1. Diagnose failed captures with scalar reports and consented examples; distinguish tracking failure, incomplete motion, unknown vocabulary and wrong classification.
2. Validate a limited vocabulary with fluent signing and unfamiliar participants, including genuine idle/nonsigning camera negatives. The user does not need to label signs they do not know; access to fluent review remains a dependency.
3. Promote only an eligible model after independent evaluation and actual device checks. Retain typing, reviewed text, local speech and direct signing video while recognition remains experimental.
4. Add live turn suggestions, interruption and measured latency after recognition earns it. A pause or hands-down motion can suggest finishing; it is not proof of a sentence boundary or meaning.
5. Research paired continuous-language data, facial/nonmanual information, names/fingerspelling, meaning-preserving sentence decoding and fluent sign replies separately. Saved phrase videos remain limited to recorded coverage.

Landmark detection supplies measurements. Google's [Holistic documentation](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/holistic.md) describes face, body and hand tracking; a separately evaluated language model is still required to establish meaning. This pilot uses the existing body/hand recordings and adds no facial grammar support.

## Verification

`npm run check` passed 565 application tests: 261 Node tests and 304 UI tests, followed by the production build. The full Python suite passed 135 tests, including twenty pilot protocol/integrity tests. `npm run build:public` also passed. The public build contains no sign model files, and development HTTP endpoints responded successfully.

Regressions cover simultaneous joint visibility, measured timing and trailing gaps, unchanged valid-capture predictions, purpose switching, stale AI replies, routing and reviewed-text transfer without automatic delivery. Automated checks simulate browser media and AI interfaces; current device rendering, actual camera behavior, audible playback, live BOOK/DRINK detection and fluent communication remain separate device checks. No live-browser inspection was performed for this update.

The user-supplied external LSTM repository was assessed read-only. Its temporal-landmark concept is useful, but its artifacts were not executed or integrated. See the [source assessment](external-lstm-review-2026-10-05.md).
