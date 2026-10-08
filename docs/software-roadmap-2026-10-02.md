# SignBridge software roadmap — 2 October 2026

**Current priority:** the [conversation quality plan](conversation-quality-plan-2026-10-02.md) prioritizes deployment, optional message clarification, revision-safe meeting cards and real-user verification for the software month. The recognition programme below remains a separate later study unless separately staffed; its proposed dates are not a commitment to run both programmes together.

The goal is a camera-based conversation that feels as direct as voice chat: sign a turn, review its meaning, receive a contextual reply, and read, hear or watch that reply. The current software provides a foundation for this workflow. The next month should improve a small, measurable signing vocabulary and verified replies before expanding to fluent conversation. ISL and ASL remain separate supported language tracks. Hardware is outside this plan.

## Completed software foundation

The current Sign Workspace connects the existing local temporal word models to a reviewed message composer and conversation history:

- Capture one complete word, finish the turn, inspect the result and correct its meaning. Uncertain candidate words are explicitly tentative; selecting a suggestion is a user decision, not another successful recognition.
- Add reviewed words to an editable message, undo additions or edits, and speak the reviewed message. Only the reviewed text is sent when the user presses Send. AI replies retain recent conversation context and can be interrupted; a new conversation clears that context.
- Display capture duration, hand/shoulder visibility, sampling and tracking gaps. These describe tracking quality, not whether the signer used the correct sign.
- Play matching sign videos from the user's local reply library. Exact phrase clips take priority; otherwise individual word clips and visible text gaps are used. Word clips in text order do not establish grammatical ISL or ASL translation.
- Explicitly save a labelled temporal pose sample after consent, using a signer code and session code. Training Studio lists known and unknown/nonsigning samples, filters ISL/ASL, deletes individual samples and exports JSON. It stores landmarks and timing locally, not camera video, and performs no upload or automatic retraining.
- Use the completed [offline importer](../training/import_samples.py) to combine disjoint export batches through repeated `--dataset` arguments. It validates consent, coordinates, timing and duplicate IDs, and requires an explicit signer-to-train/validation/test assignment shared across batches, sessions and both languages. Incomplete collections produce an inventory explaining why training arrays are unavailable rather than silently relaxing split requirements. Importing does not train or replace deployed models; participant codes and supplied labels still require independent review.

Changing the sign language or reply language starts a new conversation and stops the camera. Local recognition and message editing do not require an AI key once the needed model/tracking assets are available. Cloud replies require the local server, internet and a configured `GEMINI_API_KEY`; a key being configured does not guarantee that a provider request will succeed. The optional video-interpretation route is separate and requires explicit consent to send its clip to Google Gemini.

**The trained weights are unchanged by this software upgrade. No new recognition accuracy has been demonstrated.** The baseline remains 49 ISL words and 100 ASL words, with the recording-level results below. Neither baseline establishes unfamiliar-signer or laptop-webcam recognition accuracy.

| Existing baseline result | ISL | ASL |
| --- | ---: | ---: |
| Held-out top-1 accuracy before rejection | 75.00% | 40.78% |
| Known recordings accepted, including mistakes | 93 / 192 (48.44%) | 27 / 255 (10.59%) |
| Correctly accepted known recordings | 90 / 192 (46.88%) | 22 / 255 (8.63%) |
| Unknown-vocabulary false accepts | 27 / 200 (13.50%) | 9 / 200 (4.50%) |

See the [training and evaluation report](model-training-2026-10-01.md) for sources, splits, exclusions, calibration and numerical parity. ISL has no available signer identities in those source splits; most ASL test signers also occur in training. These limits matter more than the headline top-1 numbers.

## Four-week plan

This is a proposed programme for **2 October–1 November 2026**, not completed work. Fluent ISL and ASL signers are required to define vocabulary, verify labels, record valid signs and review reply videos. Schedule their participation before committing to the targets. If one language lacks participants, retain its existing experimental mode and report its new validation as incomplete.

| Period | Priority and work | Reviewable deliverable |
| --- | --- | --- |
| Week 1: 2–8 October | Choose a useful pilot vocabulary of about 20–25 everyday words per language with fluent reviewers. Begin ISL collection first while scheduling ASL in parallel. Record complete webcam turns across people, sessions, normal lighting and signing speeds. Include out-of-vocabulary signs and ordinary nonsigning hand movements. Verify labels independently of model suggestions; record language, stable signer codes and sessions. Assign signer-disjoint train/validation/test groups before model selection. | Vocabulary list, consented collection protocol, label-audit notes and a versioned dataset inventory. Frozen test signer/session assignments; no test recordings used for tuning. |
| Week 2: 9–15 October | Use and validate the completed offline importer with real Training Studio exports and the frozen signer assignment. Review its inventory, duplicate/timing/pose checks and split completeness; keep background turns rejected by the browser input gate separate from model-level rejection calibration. Retrain on actual webcam data. Compare the existing GRU with one bounded candidate, such as fuller hand landmarks and motion features or a small temporal convolution model, under the same split and training budget. Learn normalization on training data and select checkpoints/rejection thresholds on validation data only, separately for ISL and ASL. | Reproducible baseline/candidate report with per-word errors, accepted coverage, accepted mistakes and unknown/nonsigning rejection. Candidate artifacts must pass raw-pose preprocessing and PyTorch/browser numerical parity before app use. |
| Week 3: 16–22 October | Record and verify a small library of complete phrase replies with fluent signers and contributor permission. Integrate guided practice and the existing face-to-face workflow with the workspace: practice a verified word, review a captured turn, speak a confirmed message, then caption the partner's response and show available reply clips. Preserve the distinction between recognition, typed correction, practice feedback and cloud interpretation. | 10–15 reviewed phrase videos per language, with meaning, language, reviewer and permission recorded. A coherent practice/conversation flow with explicit gaps for unsupported replies. |
| Week 4: 23–29 October | Run real laptop-webcam trials with held-out fluent signers and sessions. Test lighting changes, occlusion, slow/fast turns and negative examples. Exercise missing/invalid keys, offline states, camera denial/disconnection, interruption, navigation and both language resets. Compare the candidate and unchanged baseline on exactly the same frozen recordings. | Honest comparison and demonstration showing correct, incorrect and rejected turns, reply-video coverage and latency. Publish methodology and aggregate results where permitted; do not assume rights to redistribute restricted source recordings or weights. |

Use 30 October–1 November for fixes and a repeatable demonstration. Keep the existing broader experimental ISL/ASL models available while evaluating the smaller pilot; successful ISL results do not count as ASL validation.

Training Studio currently caps a browser inventory at 250 samples and 32 MB. A month-long corpus needs deliberate exports, verified backups and offline aggregation across batches. Exporting or saving a sample does not update the model. Use stable signer codes across batches, and remove local samples only after checking the export.

The RTX 4060 can accelerate larger experiments once a compatible training runtime is configured. The current small CPU runs already take seconds; GPU use or a larger architecture alone does not guarantee an accuracy gain. Data quality, language-specific labels and evaluation independence are the priority.

## Proposed validation gates — targets, not achieved results

These targets apply separately to the new ISL and ASL pilot. They are conditional on participant availability and adequate independent data; none is claimed to be achieved by the current upgrade.

| Target | Measurement and interpretation |
| --- | --- |
| At least six fluent participants per language, including two held-out test signers | Keep test people out of both training and validation. Aim for at least two sessions per person. Fewer participants require an explicitly smaller claim, not a signer-independent headline. |
| At least 200 known, 200 unknown-sign and 200 nonsigning test turns per language | Balance known words across held-out people/sessions. Keep unknown signs and nonsigning turns separate. Report actual counts, exclusions and statistical uncertainty; repeated turns from one signer are not independent people. |
| At least 95% precision on accepted known-word turns and at least 60% correctly accepted known-word coverage | Precision = correct accepted known turns / all accepted known turns. Correct coverage = correct accepted known turns / all known turns. Report both, plus per-word results, so rejecting nearly everything cannot appear successful. |
| At most 5% unknown-sign false accepts and at most 2% nonsigning false accepts | False accept = a negative turn emitted as any recognized word. Also report accepted errors and precision across the declared complete test mixture; model probability is not a correctness guarantee. |
| Local Finish-to-result p95 of at most one second on this laptop | Measure after Finish is pressed, separately from signing duration, tracking initialization, cloud AI latency and reply playback. Report cloud reply latency separately under the actual network/provider conditions. |
| 10–15 fluent-reviewed complete reply phrases per language | Count exact phrase coverage in the demonstration. Missing phrases remain visible text; do not score word concatenation as fluent signed output. |
| Twenty repeated lifecycle cycles without stale output or retained camera tracks | Include capture/cancel/end/restart, AI interruption and language changes. Check late results, late speech, camera release and saved-data behavior. Pair automated checks with real browser/camera checks. |

If a candidate misses these gates, keep it experimental and retain manual review; do not lower rejection thresholds solely to make it speak more often. Freeze and version the model, vocabulary, feature contract, split inventory and calibration used in every comparison. Public-dataset results can be reported beside webcam results as context, but different vocabularies or splits are not a fair head-to-head comparison.

## What the month-end demonstration should establish

Show a person signing a supported isolated word, reviewing it, composing a message and receiving a contextual text reply with available speech or a verified phrase video. Then show an unsupported sign, a nonsigning movement, correction, interruption and a language change. State which words, people and conditions were actually tested and which replies have video coverage.

This can demonstrate useful sign-mediated turn taking. Continuous sentence recognition, facial grammar, unrestricted fingerspelling and a fluent generated signing avatar remain research work beyond this month. The [current training report](model-training-2026-10-01.md) remains the recognition baseline until a separately evaluated model replaces it.
