# ASL signer-separated comparison — 4 October 2026

**Six fresh matched training runs and one frozen final comparison completed. No model passed selection or was promoted.** This is a separate experiment from the original ISL/ASL recording-split benchmark.

The same historical ASL corpus is regrouped by signer: 1,202 training clips from 67 signers, 373 validation clips from 14 signers, and 450 known test clips from 15 signers. Every group contains all 100 trained classes. Training/selection/calibration signer identities have zero overlap with final known/unknown test identities. This does not turn previously inspected recordings into newly collected or untouched test data.

GRU27 and GRU75 use exactly matched clip order, vocabulary and targets, with fresh statistics fitted on this study's training clips only. Both use seeds 42/43/44, an 80-epoch ceiling, validation-based early stopping, AdamW and a 1,200-second per-run ceiling. All six runs completed in approximately 389 cumulative training seconds; profiling, tests and evaluation are separate. No augmentation, architecture change or threshold revision followed the final comparison.

| Final test across three seeds | Matched GRU27 | Full 75-joint GRU |
| --- | ---: | ---: |
| Top-1 mean before rejection | 28.1% | 27.1% |
| Top-1 seed range | 27.1%–29.8% | 26.7%–27.6% |
| Correctly accepted coverage, mean | 0.74% | 0.59% |
| Accepted correct, seeds 42/43/44 (of 450 each) | 0 / 10 / 0 | 7 / 1 / 0 |
| Accepted wrong, seeds 42/43/44 | 0 / 1 / 0 | 2 / 0 / 0 |
| Unknown false accepts, seeds 42/43/44 (of 112 each) | 0 / 2 / 0 | 2 / 1 / 0 |

There is no demonstrated generalization improvement for the full-joint GRU in this experiment. The declared all-seed validation gates require at least 95% accepted-known precision, 60% correctly accepted coverage and at most 5% unknown false accepts, plus a 5-percentage-point coverage gain over the matched control. Both architectures failed; validation selected no candidate before final inference. The descriptive final comparison confirms weak performance. Neither model is enabled in the app.

Calibration uses 40 actual out-of-vocabulary clips; final unknown testing uses 112. These are isolated unknown signs, not idle or ordinary camera movements. One unknown word is shared across the holdouts. Repeated signer/word clips are correlated, and all seeds predict the same recordings. Do not pool seeds as independent test samples. Some seeds had no qualifying validation operating point, so their offline acceptance is disabled: zero accepts in those rows are not evidence of a useful perfect rejector. Per-seed known precision, mixture precision, counts and Wilson intervals are in the final JSON.

## Evidence and reproduction

- [Strict negative assignment protocol](../asl-strict-negative-protocol-2026-10-04.json) and [prepared inventory](../asl-signer-strict-study-2026-10-04.json).
- [Comparison preregistration](experiment.json), recorded before these six training runs.
- [Validation selection](selection.json), [selection hash](selection.json.sha256), and [one final benchmark](final.json).
- [All six run metrics](runs.csv) and [600 per-word rows](per-word.csv).

`training/freeze_signer_experiment.py` records identities/hashes and rejects actual signer leakage without reading final feature/target arrays. `training/compare_signer_study.py` validates all six checkpoints, tensor structure, training experiment, data/metadata/protocol/inventory hashes, matching legacy controls, budgets, vocabulary, signer isolation and freshly recomputed calibration before any final prediction. Selection has a SHA sidecar; an exclusive final record prevents rerunning the same frozen selection under another report name. These scripts never promote a model.

For a new independently documented study, use fresh protocol, run and report paths. Do not reuse the completed immutable output paths. The original recording-split datasets, weights and reports are retained. The browser runtime parity measurements from the original experiment do not validate these newly trained models, which have not been exported or installed.

## Product verification and limits

The accompanying Workspace fix waits for actual measured frames before Capture. After two seconds without new frames, it labels tracking paused and disables new captures; Finish/Cancel, reviewed text and camera ownership are retained. A new frame restores capture eligibility. Nine new regressions cover this behavior and pending-result cancellation.

`npm run check` passed 231 Node tests and 237 UI tests (468 total), followed by the production/PWA build. Python discovery passed all 115 tests, including 13 synthetic comparison lifecycle/integrity cases and four preregistration checks. `npm run build:public` passed, and its final `dist` contains no model directory or research binary artifacts. Actual camera/voice/Android trials remain unverified. Local website startup was rejected by tool approval review with only “blocked by policy” as the stated reason; no alternative startup or browser-inspection path was used.

The next research step needs better training/generalization and genuine camera-domain negative examples, evaluated under a fresh validation protocol. ISL signer isolation cannot be fabricated from missing source identities. Facial grammar, continuous sentences and fluent-user meaning validation remain outside this isolated-word comparison.
