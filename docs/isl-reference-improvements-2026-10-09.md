# Improvements informed by the ISL interpreter reference

Reviewed reference: [farihaNaqvi/MediaPipe-ISL-Virtual-Interpreter](https://github.com/farihaNaqvi/MediaPipe-ISL-Virtual-Interpreter/tree/7b4a5f505c9e60bc0bb3d3d6524c93c4ac5b568a), pinned at `7b4a5f505c9e60bc0bb3d3d6524c93c4ac5b568a`.

The reference contains a five-label sign classifier, a separate four-label desktop-command classifier, and five source sign GIFs. Its first accepted prediction does not update the main text labels, and its reverse lookup silently drops unsupported words. We inspected source and model metadata; we did not execute the reference, install its dependencies, measure its accuracy, or import its weights, code or animations.

## Changes in SignBridge

### Completed results are easier to find

After a completed camera capture, Connect now focuses and scrolls to the word-review heading. The first word and a later repetition each expose their fresh result. A rejected capture exposes its explanation in the same place. Editing an existing result does not steal focus; cancelled, obsolete or unmounted asynchronous results cannot move it.

Recognition still produces a tentative word. Speaking, adding it to a draft and sending to a partner remain explicit actions. No classifier weights, thresholds, camera ownership or automatic speech behavior changed.

### Saved reply videos cover more of the original message

The planner now selects an ordered combination that maximizes covered words, then prefers fewer clips, then a longer current phrase for deterministic ties. It retains unsupported words in their original order and keeps ISL, ASL and text languages separate.

Example: with saved clips `hello how`, `hello`, and `how are you`, the old greedy planner covered only two words of `hello how are you`. The new plan chooses `hello` followed by `how are you`, covering all four. For `not hello how are you`, the unsupported `not` remains visible and pauses playback; it is never discarded. These examples describe lookup behavior, not verified sign recordings.

Playing individual clips in text order does not supply sign-language grammar. The source text and coverage gaps remain visible; no new reviewed sign-video vocabulary was added.

### Existing LSTM research gets a coordinate-provenance prerequisite

SignBridge already has a separate GRU75/LSTM75 comparison runner. Adding another LSTM would duplicate it. New temporal studies now require a bounded, data-bound declaration of source XY conventions, conversion before shoulder normalization and canonical camera coordinates. A read-only `--check-only` command validates that declaration without importing the training runtime, decoding feature arrays, fitting models or creating output files.

This is declared-provenance validation, not proof that original poses were converted correctly or that browser parity passed. An audit-report hash is a reference, not verified report contents. Historical unannotated prepared arrays remain unannotated and cannot pass this new temporal-study gate. Existing frozen graph studies are unchanged. See [the temporal-study instructions](temporal-lstm-control-2026-10-08.md).

## Verification and limits

- `npm run check` passed: 321 Node tests, 432 UI tests and the regular production build.
- `npm run build:public` passed last; local research artifacts remain excluded. The existing large JavaScript chunk warning remains.
- The full Python suite passed 166 tests. Fresh-process checks verify that coordinate preflight creates neither experiment outputs nor bytecode files; current unannotated ISL data is rejected with an actionable error. No model fitting was performed.
- The reviewed-sign integration test uses real GRU inference, camera-turn validation, local HTTP room membership, WebSockets and message delivery with synthetic poses/model weights and mocked speech. Two separate HELLO turns reach the receiver as two distinct messages and two speech requests; receipts and rerenders do not add a third playback. Both ISL and ASL metadata routes passed.
- Planner and review-focus tests cover overlaps, missing negation, repeated words, language isolation, first results, rejection explanations, cancellation and stale asynchronous callbacks.

No new sign training, fluent-signer evaluation, webcam recognition accuracy, physically audible playback or physical two-device result is established by these changes. The external five-word model was not promoted. These changes are local source updates; the current Render service has not been redeployed by this work.
