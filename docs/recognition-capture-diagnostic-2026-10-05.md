# BOOK / DRINK capture diagnostic — 5 October 2026

This report is a read-only diagnostic of existing source code, training data and reused-validation results. **No new training, inference, final-test feature access, threshold changes, export or model promotion was performed.** The user's failed live BOOK / DRINK captures were not retained for this audit, so their exact failure cause cannot be determined.

## Findings that affect the next software change

1. **One complete detected hand plus both shoulders is the appropriate general capture-readiness condition.** The source DRINK examples mostly contain one detected hand. Requiring two hands for every word would exclude that pattern. For two-hand actions such as the supported BOOK reference, the user should keep both signing hands in view; the app cannot infer a word-specific requirement from a vocabulary search or treat the searched word as a prediction.
2. **Start/Finish timing needs visible guidance.** Both preprocessing contracts trim absent-hand endpoints, but retain leading/trailing frames while hands remain detected. Long pauses with hands visible are therefore part of the 32-frame input. A clear “Capture → perform one full movement → Finish” flow can reduce this avoidable capture ambiguity. It does not establish that a particular pause caused the failed user trial.
3. **Keep inference failures distinct from capture failures.** A fresh camera frame with visible joints is evidence of tracking. It is not evidence that the model understands the sign. The current camera gate checks sample count, timing, shoulders and at least one wrist; subsequent learned-word rejection remains separate.
4. **Clipping should be a framing warning, rather than a universal word-rejection rule.** The existing preview flag marks a hand landmark near the image edge. It cannot prove whether the complete linguistic movement was lost.
5. **Add genuinely recorded nonsigning examples with explicit consent and a separate sample subtype.** No idle-camera negatives were used in the fixed word pilot. Such samples must not be assigned a positive sign label, manufactured from sign recordings or included in old final-test partitions. They can support a separately declared future train/calibration/evaluation study; collection alone does not prove a false-positive rate.

## Aggregate source-pose measurements

The audit selected BOOK and DRINK using the unchanged strict ASL **training and validation** target arrays, then read only their corresponding original pose entries with the bounded `PoseArchive` / `RestrictedUnpickler` loader. No clip or signer identities are included here. Fractions below are the average within-clip fractions after trimming to the first/last frame where at least one hand wrist has confidence >= 0.5. Shoulder qualification uses both shoulder confidences >= 0.2.

| Word | Split | Clips | Raw frames, min / median / max | Both hands visible, mean | At least one hand visible, mean | Shoulders qualified, mean |
| --- | --- | --- | --- | --- | --- | --- |
| BOOK | Training | 33 | 31 / 83 / 124 | 69.4% | 93.9% | 100% |
| BOOK | Reused validation | 4 | 33 / 69 / 96 | 72.7% | 90.2% | 100% |
| DRINK | Training | 23 | 35 / 60 / 133 | 0.0% | 81.0% | 100% |
| DRINK | Reused validation | 5 | 37 / 76 / 89 | 1.7% | 69.3% | 100% |

Prepared 32-frame graph inputs had both hands observed in 68.2% / 71.9% of BOOK training / validation frames, versus 0.0% / 1.9% for DRINK. Missing-node feature values were zero in all four inspected groups. These are tracking measurements, not fluent-sign correctness or recognition accuracy. Frame counts cannot be converted into source durations: usable source timestamps/FPS were not retained in this prepared feature contract.

## Why the existing pilot still rejects these words

The frozen twelve-word pilot used 198 training clips from 39 signer codes, 39 known validation clips, 40 genuine out-of-vocabulary validation clips and 334 excluded-known-word validation clips. These are reused selection data. All six runs failed the fixed validation gates, and no candidate was promoted.

| Arm / seed | BOOK top-1 correct / 4 | BOOK accepted correct / 4 | DRINK top-1 correct / 5 | DRINK accepted correct / 5 |
| --- | --- | --- | --- | --- |
| None / 42 | 3 | 0 | 2 | 0 |
| None / 43 | 4 | 0 | 1 | 0 |
| None / 44 | 3 | 2 | 3 | 0 |
| Mild spatial / 42 | 3 | 0 | 2 | 0 |
| Mild spatial / 43 | 4 | 0 | 1 | 0 |
| Mild spatial / 44 | 4 | 1 | 4 | 0 |

The stored DRINK validation confusions include WHO, BIRD and BROWN. BOOK errors include FAMILY. These are observed model-label confusions; this audit does not establish which linguistic distinction or body feature explains them.

In the unaugmented seed-44 run, all five DRINK top scores were below the frozen 0.94 confidence threshold, and their margins were below the required 0.50. In the augmented seed-44 run, all five DRINK top scores were below the frozen 0.98 threshold. The outcomes thus have an explainable **recorded inference/rejection reason** even when the highest-scoring label is correct. Lowering the thresholds would abandon the separately constrained unsupported-word rejection protocol and is not a fix established by these results.

Other runs fail closed when no grid setting satisfies the known-precision and two separate negative-group constraints. A 100% accepted-known precision figure for one or two accepted clips should not be mistaken for a useful recognizer: aggregate correct coverage was only 1.71% in both arms, versus the required 60%.

These 75-joint pilot results are not the output of the deployed historical 27-joint model on the user's webcam capture. They explain the research pilot's limitations and cannot diagnose that user's unretained clip. See [the fixed pilot report](recognition-pilot-2026-10-05/README.md).

## Training/browser feature comparison

No proven joint-order or preprocessing mismatch was found in the inspected code:

- Both use body 33 + left hand 21 + right hand 21 ordering.
- OpenHands gives every landmark in a detected hand confidence 1; `poseFrameFromHolistic` deliberately does the same for a complete finite hand array. Body visibility is retained, and incomplete hands remain absent.
- The legacy Python/browser contract uses the same 27 joints, shoulder centering/scaling, confidence gates and linear 32-frame resampling.
- The graph Python/browser contract uses the same 75 joints, observed-node masks, shoulder centering/scaling and half-up nearest-frame resampling. Its learned XY normalization is embedded once in the model and fitted on training only; confidence remains unstandardized.
- The existing archived **validation** feature-parity report records zero maximum raw-feature and normalization difference for three ISL and three ASL recordings plus synthetic edge cases. It establishes numerical parity on those checks, not live-camera recognition accuracy. That report was read, not rerun.

There are plausible distribution differences that remain unmeasured:

- The cached OpenHands extraction source processes every decoded frame with older Solutions Holistic (`model_complexity=2`). The live hook uses Tasks Holistic and samples at most eight times per second; a slow device can produce fewer observations. Different detector generations and temporal sampling can change measured features, but the raw frame counts above do not quantify that effect without source FPS/durations and matched live recordings.
- The contracts normalize image x/y coordinates by shoulder width without separately retained image-aspect metadata. Camera/source aspect and viewpoint differences may change normalized geometry. This is not a proven browser-only bug, and changing only browser inference would break the existing feature contract.
- Neither contract includes facial expression features or validated common-coordinate depth. The pilot is isolated-word recognition, with no evidence for continuous sentence translation.

## Inspected material and boundaries

Inspected source/artifact types:

- Cached official extraction source: `.training-data/metadata/OpenHands-official-mediapipe-extract-source.txt`.
- Original ASL pose archive: `.training-data/archives/WLASL.zip`, only BOOK / DRINK entries selected from training and reused validation; bounded restricted numeric loader, no extraction or arbitrary pickle execution.
- Strict prepared ASL NPZ: `.training-data/graph-v1/asl-signer-disjoint-strict/asl.npz`, only vocabulary and training/validation targets, IDs, raw graph features and masks needed for those groups; `allow_pickle=False`.
- Frozen small-vocabulary protocol, aggregate summary, per-class/confusion CSVs and stored **validation** probabilities. No checkpoint execution or new predictions.
- `training/prepare_data.py`, `training/pose_graph.py`, `training/graph_models.py` and `training/graph-contract-v1.json`.
- Browser adapters: `src/lib/trainedSignModel.js`, `src/lib/poseGraphFeatures.js`, `src/lib/graphSignModel.js`, `src/lib/cameraWordRecognition.js`, `src/lib/signWorkspace.js`, `src/lib/handJoints.js`, plus camera/tracking hooks and capture flow.
- Existing `docs/graph-model-evaluation/feature-parity-2026-10-04.json`, limited to archived-validation parity evidence.

No final-test NPZ feature/target arrays or final-test predictions were opened. No frozen results, protocols, source data, weights or deployed artifacts were changed. No camera, browser or real-device test was performed. The source-protocol and pilot integrity checks recorded earlier remain separate from this read-only diagnostic.

The immediate justified software change is clearer measured capture readiness and complete-movement guidance, with a one-hand-compatible gate. The next justified data step is explicit, separately labelled nonsigning collection followed by a new declared evaluation protocol. Neither step by itself fixes BOOK / DRINK recognition or establishes successful translation.
