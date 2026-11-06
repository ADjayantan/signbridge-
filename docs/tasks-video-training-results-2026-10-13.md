# Current-detector ISL training results — 13 October 2026

**Decision: keep the existing laptop model. Neither candidate passes the declared installation requirements.** Candidate B accepts one of two official HELLO test recordings, but its overall known-word coverage and unsupported-word rejection fail. These results do not establish recognition on Jai's webcam or successful sign-to-voice communication.

The study downloaded 60 official videos, extracted their joints with the app's current browser detector, fitted two declared candidates, and evaluated both on one shared test export after both candidates were frozen. No confidence threshold was reduced, no expected label was supplied to inference, no rejected guess was spoken, and neither candidate was installed or deployed.

Tracked scalar evidence: [tasks-video-training-metrics-2026-10-13.json](C:/Users/adjay/Downloads/signbridge/docs/tasks-video-training-metrics-2026-10-13.json). Raw videos, poses, model weights and detailed artifacts remain in ignored local research directories.

![Temporary research diagnostic showing measured A/B results and the retained active model](C:/Users/adjay/Downloads/signbridge/docs/tasks-video-training-results-2026-10-13.jpg)

This screenshot records a temporary research diagnostic; it is not an installed product feature. The diagnostic tab was closed after export.

## Sources, acquisition and actual extraction

The videos are from the [official INCLUDE release](https://zenodo.org/records/4010759), attributed to Advaith Sridhar, Rohith Gandhi Ganesan, Pratyush Kumar and Mitesh Khapra (2020). The [official dataset card](https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md) specifies CC BY 4.0. Original archived poses came from the checksum-verified [OpenHands pose release](https://zenodo.org/records/6674324). INCLUDE contains isolated regional ISL examples; it does not cover every sign, regional variant or continuous sentence.

The initial 66-video selection exceeded the existing 900 MiB selected-payload limits. A documented amendment reduced only three known training quotas before downloading or predicting new videos. The resulting frozen 60-video selection retained the validation/test groups and their separation.

| Partition | Known videos | Unsupported videos | Role |
|---|---:|---:|---|
| Training | 22 | 12 | Gradients |
| Validation | 6 | 6 | Checkpoint selection |
| Test | 8 | 6 | One shared post-freeze evaluation |

Selected payloads were 905,215,502 compressed bytes and 923,927,972 decompressed bytes, each below 900 MiB. Every saved member passed the exact ZIP member identity, CRC32, size and read-back SHA-256 checks. Partial ZIP ranges do **not** verify the whole raw-video archives' published MD5 values. The app-level receipt records 918,929,471 confirmed response-body bytes and a conservative charge of 930,545,767 bytes, below the 1 GiB cap; this includes an 11,616,296-byte interruption reserve. HTTP headers and transport wire bytes were not measured.

Extraction used the same Tasks Holistic CPU VIDEO loader and pose adapter as the app, a 1280×720 black contain canvas, and source seeks at 0, 125, 250 ... milliseconds strictly before each clip's end. Each serialized joint is `[x, y, confidence]`, in body33/left21/right21 order. No z-as-confidence, synthetic end holds, mirroring or reversed sequences were introduced. A fresh tracker was created and released for each video.

| Export | Selected / successful | Measured pose samples | Source footage duration | Observed extraction wall time |
|---|---:|---:|---:|---:|
| Learning | 46 / 46 | 1,056 | 129.480 seconds | 158.494 seconds |
| Test | 14 / 14 | 304 | 37.320 seconds | 44.986 seconds |

All 60 outcome rows have status `ok`; no failed source was dropped from the inventory. Source seeks are sequential sampling requests; decoded frames follow the browser's encoded-frame selection. These timings do not demonstrate webcam tracking at eight frames per second.

The test export was produced once after both candidates froze. Both benchmark reports bind the same SHA-256: `f64a71f5087977024ea8dcd817de273a9f96a73e098fd6ff83b4814a4549d3a3`. The frozen manifest is `f69e405674b4fb39d128d2962202c1d46fdd7c50d44640b7c3c003635d829c2d`.

## Training inventory and the two declared trials

Both runs warm-started the previous camera-aligned candidate `a77f33b3f0d2ca7570b041e4cf93fa1ee3374efc6e974cb975ae80f587041004`. They retained its normalization, 49-label order and GRU27 architecture, with acceptance score 0.95 and margin 0.30. Both used known-label cross-entropy plus 0.25 uniform-target outlier cross-entropy, AdamW learning rate 0.0005, weight decay 0.0001, seed 42, four CPU threads, known batch 64, negative batch at most 16 and gradient norm limit 5. Budgets remained at most 120 epochs/600 seconds, with the declared early stopping rule.

The 22 known Tasks training videos are re-extractions of IDs already present among the 628 archived training recordings. There are **628 unique known source recordings**, represented by 650 detector feature rows before weighting. Weighting creates sampling entries, not new recordings.

The fresh Tasks unsupported sources are HOW ARE YOU, ALRIGHT and GOOD AFTERNOON: four training recordings each. GOOD EVENING supplies six validation recordings; GOOD NIGHT and PLEASED supply three test recordings each. Their source words and clip IDs are disjoint across those roles. An additional 200 archived official-train negatives were selected deterministically across 50 source words, excluding every legacy partition ID, every new manifest ID, all previous unsupported holdout source words and the new unsupported validation/test source words. The negative pool has 212 unique recording IDs. These are unsupported signs, not idle-camera or ordinary-motion negatives.

| Item | Candidate A | Candidate B |
|---|---:|---:|
| Original archived known entries | 628 | 628 |
| Weight per known Tasks representation | 4 | 16 |
| Weighted known entries | 716 | 980 |
| Weight per fresh Tasks unsupported representation | 1 | 4 |
| Archived negative entries | 200 | 200 |
| Weighted negative entries | 212 | 248 |
| Unique known source IDs | 628 | 628 |
| Unique negative source IDs | 212 | 212 |
| Epochs / selected epoch | 45 / 25 | 47 / 27 |
| Measured fitting time | 11.836 seconds | 16.031 seconds |

Candidate A selected validation top-one macro recall minus unsupported false acceptance, breaking ties with lower known validation cross-entropy. Its validation coverage failed. Before test extraction, one follow-up protocol declared B's stronger Tasks sampling weights and selection by macro correctly accepted recall minus accepted-wrong/all-known-source rate minus unsupported false acceptance, with the same cross-entropy tie-break. This was validation-guided development. No further trial or test-guided calibration followed.

**Metadata erratum:** B's frozen `preparation.json` field `distinctKnownTrainingClips: 650` sums detector representation rows. An explicit ID union confirms that all 22 Tasks known training IDs overlap the original 628, so the correct unique source count is 628. The tracked scalar evidence and this report contain the correction. Frozen sources and artifacts were preserved. The fitted sampling weights and gradients are unaffected.

Protocols: [original Tasks study](C:/Users/adjay/Downloads/signbridge/docs/tasks-video-training-protocol-2026-10-11.md), [declared stage-two follow-up](C:/Users/adjay/Downloads/signbridge/docs/tasks-video-stage2-protocol-2026-10-13.md).

## Current Tasks video results

Accepted precision is correct accepted outputs divided by all accepted outputs. Correct coverage is correct accepted outputs divided by all selected known sources. Unsupported false acceptance uses all selected unsupported sources. Top-one guesses below the fixed acceptance gates produce no message or speech.

Validation uses six known and six unsupported recordings. The active model's Tasks validation prediction was not part of the recorded benchmark, so no value is invented for it.

| Model | Correct top-one | Accepted correct / wrong | Correct coverage | Unsupported falsely accepted |
|---|---:|---:|---:|---:|
| Warm start | 5/6 | 3 / 0 | 50.0% | 3/6 — 50.0% |
| A | 6/6 | 2 / 0 | 33.3% | 0/6 — 0.0% |
| B | 5/6 | 5 / 0 | 83.3% | 1/6 — 16.7% |

The shared final test uses eight known recordings: two each of HELLO, THANK YOU, GOOD MORNING and FATHER, plus six unsupported recordings.

| Model | Correct top-one | Accepted correct / wrong | Correct coverage | Unsupported falsely accepted |
|---|---:|---:|---:|---:|
| Active laptop model | 1/8 | 1 / 0 | 12.5% | 1/6 — 16.7% |
| Warm start | 7/8 | 4 / 0 | 50.0% | 2/6 — 33.3% |
| A | 7/8 | 1 / 0 | 12.5% | 0/6 — 0.0% |
| B | 6/8 | 2 / 0 | 25.0% | 2/6 — 33.3% |

Accepted precision is 100% for the known outputs in these small Tasks groups. That does not make their sparse output coverage or unsupported-word performance sufficient.

| Known test word | A correctly accepted | B correctly accepted |
|---|---:|---:|
| HELLO | 0/2 | 1/2 |
| THANK YOU | 1/2 | 1/2 |
| GOOD MORNING | 0/2 | 0/2 |
| FATHER | 0/2 | 0/2 |

Neither candidate accepted a wrong label on the two HELLO test recordings. B's one accepted HELLO is official video replay evidence; no live webcam recognition or audible speaker result was measured by this study.

## Complete historical archived-pose regression

These partitions have been examined in previous studies. Current-detector test videos also reuse recordings whose older archived poses appeared in those studies. Recording separation within fitting is preserved, but these are not new unseen signers or an untouched blind test. Signer IDs are unavailable. Original poses lack verified frame timestamps, so their evaluation differs from current Tasks video replay.

| Partition / model | Correct top-one | Accepted correct / wrong | Accepted precision | Correct coverage | Unsupported false acceptance |
|---|---:|---:|---:|---:|---:|
| Validation — active | 90/117 | 47 / 6 | 88.7% | 40.2% | 10/100 — 10.0% |
| Validation — warm start | 105/117 | 83 / 3 | 96.5% | 70.9% | 23/100 — 23.0% |
| Validation — A | 99/117 | 32 / 0 | 100.0% | 27.4% | 4/100 — 4.0% |
| Validation — B | 102/117 | 25 / 0 | 100.0% | 21.4% | 3/100 — 3.0% |
| Test — active | 144/192 | 90 / 3 | 96.8% | 46.9% | 27/200 — 13.5% |
| Test — warm start | 179/192 | 133 / 3 | 97.8% | 69.3% | 36/200 — 18.0% |
| Test — A | 176/192 | 47 / 1 | 97.9% | 24.5% | 3/200 — 1.5% |
| Test — B | 178/192 | 36 / 1 | 97.3% | 18.8% | 4/200 — 2.0% |

Outlier exposure reduced historical unsupported false acceptance, while correctly accepted known coverage dropped below the active model. High top-one accuracy therefore did not produce usable translation coverage.

## Decision and engineering verification

The declared screens require at least 95% accepted known precision, at least 60% correct known coverage, and at most 5% unsupported false acceptance in the required Tasks and archived groups, numerical parity, no primary regression against the active model, and a correctly accepted HELLO test recording without an accepted wrong HELLO label. A fails validation/test coverage and HELLO acceptance. B fails validation/test unsupported rejection and test coverage. Both fail historical coverage and regress against the active model's coverage. **Both remain uninstalled research candidates.**

The active laptop model remains byte-for-byte `55c23fffe387944a102c804676ae91aa7276781d598b7adaf03f0115234acdd9`. Keeping it does not imply it passes these new research screens or works reliably on the user.

Both candidates passed Python/JavaScript numerical parity on three actual current Tasks learning-only validation sequences and the empty-detection gate. Maximum feature error was `6.11e-7`; maximum probability errors were `4.72e-7` for A and `1.04e-6` for B, below the `1e-5` tolerance. These are arithmetic and pipeline checks, not human signing accuracy.

The completed engineering checks were 245 Python tests, 377 Node tests, 510 UI tests and the normal production build through `npm run check`. The final `npm run build:public` also passed; `dist/models` is absent and the active local ISL model SHA remained unchanged. Automated test counts do not establish recognition on a webcam, hearing of voice output or successful communication between two people.

Candidate hashes:

- A: `dff40d9aa064429e845604ab4358d361b076f3e64014f5f8f0fe019cf4a59b79`.
- B: `e44e19d151f8a73d9b983af277a05fc3032e3d3a504102391d0255ab23afe2d3`.

Detailed local artifacts: [A benchmark](C:/Users/adjay/Downloads/signbridge/training/artifacts/tasks-video-isl-2026-10-13/benchmark.json), [B benchmark](C:/Users/adjay/Downloads/signbridge/training/artifacts/tasks-video-stage2-isl-2026-10-13/benchmark.json), [A parity](C:/Users/adjay/Downloads/signbridge/training/artifacts/tasks-video-isl-2026-10-13/browser-numerical-parity.json), [B parity](C:/Users/adjay/Downloads/signbridge/training/artifacts/tasks-video-stage2-isl-2026-10-13/browser-numerical-parity.json).

## Recorded reproducible commands

These are the invocations used for the frozen study. Existing output directories and benchmark files deliberately refuse overwrite. Do not rerun them to search for a better result on the examined test set. Browser extraction used `scripts/extract-tasks-training.browser.js` with explicitly selected public `File` objects, first `partitionGroup: "learning"`, then `partitionGroup: "test"` after both freezes.

```powershell
Set-Location 'C:/Users/adjay/Downloads/signbridge'
.training-venv/Scripts/python.exe -B training/train_tasks_video_study.py --manifest .training-data/tasks-video-study-2026-10-13/manifest.json --poses .training-data/tasks-video-study-2026-10-13/learning-poses.json --initial training/artifacts/camera-aligned-isl-2026-10-11/candidate.json --protocol docs/tasks-video-training-protocol-2026-10-11.md --extractor scripts/extract-tasks-training.browser.js --output training/artifacts/tasks-video-isl-2026-10-13
.training-venv/Scripts/python.exe -B training/train_tasks_video_stage2.py --manifest .training-data/tasks-video-study-2026-10-13/manifest.json --poses .training-data/tasks-video-study-2026-10-13/learning-poses.json --initial training/artifacts/camera-aligned-isl-2026-10-11/candidate.json --protocol docs/tasks-video-stage2-protocol-2026-10-13.md --extractor scripts/extract-tasks-training.browser.js --output training/artifacts/tasks-video-stage2-isl-2026-10-13
node training/check-camera-candidate-parity.mjs training/artifacts/tasks-video-isl-2026-10-13 training/artifacts/tasks-video-isl-2026-10-13/browser-numerical-parity.json
node training/check-camera-candidate-parity.mjs training/artifacts/tasks-video-stage2-isl-2026-10-13 training/artifacts/tasks-video-stage2-isl-2026-10-13/browser-numerical-parity.json
.training-venv/Scripts/python.exe -B training/train_tasks_video_study.py --evaluate-study training/artifacts/tasks-video-isl-2026-10-13 --test-poses .training-data/tasks-video-study-2026-10-13/test-poses.json
.training-venv/Scripts/python.exe -B training/train_tasks_video_stage2.py --evaluate-study training/artifacts/tasks-video-stage2-isl-2026-10-13 --test-poses .training-data/tasks-video-study-2026-10-13/test-poses.json
```

## What the next data collection must add

Further useful training needs consented recordings processed by this exact current detector and capture flow, with verified ISL labels. Start with a limited 10–12-word vocabulary, varied lighting/framing, and several fluent signers; reserve at least one person's recordings for evaluation and keep repeated takes from a session together. Add labelled idle-camera, ordinary hand movement, incomplete signs, transitions and unsupported signs so rejection is evaluated on actual non-signing situations. Freeze that separate development/evaluation design before fitting. The already examined test set must not drive further parameter changes.

After a candidate passes those data checks, separately test Jai's webcam capture, text display, reviewed message handling and audible read-aloud on the laptop. Continuous sentence translation, facial grammar, natural sign replies and reliability across users remain unproved.
