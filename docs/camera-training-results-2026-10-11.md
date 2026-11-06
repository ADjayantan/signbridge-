# ISL camera-aligned training results — 11 October 2026

**Decision: retain the existing active model. Do not promote this candidate.** The candidate improves recognition on archived poses, but accepts too many unknown words and rejects the selected HELLO test video in both browser geometries. The fixed score threshold remains 0.95 and margin remains 0.30. No acceptance flags, labels or expected-word shortcuts were changed to make a reference pass.

This is a completed local 49-word ISL research study, not evidence of a reliable live or sentence translator. ASL was not retrained in this experiment. The [protocol frozen before fitting](C:/Users/adjay/Downloads/signbridge/docs/camera-training-protocol-2026-10-11.md) defines the decision rules.

## Sources, partitions and fitting

The original videos come from the official [INCLUDE release](https://zenodo.org/records/4010759), by Advaith Sridhar, Rohith Gandhi Ganesan, Pratyush Kumar and Mitesh Khapra, “INCLUDE: A Large Scale Dataset for Indian Sign Language Recognition,” ACM Multimedia 2020, [DOI 10.1145/3394171.3413528](https://doi.org/10.1145/3394171.3413528). The [official dataset card](https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md) declares CC BY 4.0, supplies metadata rather than video bytes, and notes regional variation. Training uses the authors' video-derived poses from the [OpenHands labelled-pose release](https://zenodo.org/records/6674324), credited to Gokul NC and Premkumar Selvaraj.

The original 49-word subset and all five existing partitions were retained:

| Partition | Distinct source recordings | Use in this study |
|---|---:|---|
| Known training | 628 | Fitting; four variants per recording produce 2,512 feature rows |
| Known validation | 117 | Checkpoint selection and reporting |
| Unknown-word validation | 100 | Reporting only; no fitting or checkpoint selection |
| Known historical benchmark | 192 | One separate evaluation after candidate freezing |
| Unknown-word historical benchmark | 200 | Same separate evaluation |

The 2,512 rows are transformed observations of 628 real recordings, not 2,512 independent videos or new sign examples. Each original appears with the four fixed original/aspect/sparsity profiles; no training variants were skipped. No mirrored/reversed signs or repeated fabricated hold frames were added. Source poses have no verified frame timestamps: stride augmentation is not measured eight-Hz video.

The complete pose archive was checked against the published 662,887,244-byte INCLUDE.zip and MD5 f99f6f3ea50d5d94e0ffae44130a6672. The cached nested pose ZIP was bound to the verified outer member by SHA-256. Original x/1080 and y/1920 were converted before shoulder normalization, clipping and resampling. Historical clipped features were not relabelled as camera coordinates. Coordinate provenance establishes the axis conversion; it does not establish exact parity between archived extraction and today's browser detector.

Training used the existing GRU27 architecture: 27 joints, 81 inputs, 32 resampled frames, 64 hidden units and 31,409 parameters. Seed 42 and four CPU threads were fixed, with a 120-epoch/600-second limit. The run stopped early after **60 epochs and 153.746 seconds**, retaining epoch **40**. Checkpoint selection used validation macro recall, breaking an exact tie by lower validation cross-entropy. The selected recall was 0.887755 and loss 0.406647.

Normalization was fitted on augmented training rows only. Clip identities are unique and disjoint across partitions; final identities were inspected to verify nonoverlap, while final targets and pose features were excluded from fitting. Unknown validation did not influence model selection. Validation and benchmark have been examined in earlier work, so these are reused regression evaluations. ISL signer identities are unavailable: recording separation is not signer independence.

## Immutable archived-pose results

Both models were evaluated on the same original recordings with their respective input contracts. Results use the serialized weights, fixed gates, and no refitting or recalibration. “Precision” means accepted correct / all accepted known clips; “correct coverage” means accepted correct / all known source clips. Unknown false acceptance is measured separately and is not included in known precision.

| Split / model | Top-1 correct | Accepted correct / wrong | Rejected | Known precision | Correct coverage | Unknown false accepts |
|---|---:|---:|---:|---:|---:|---:|
| Validation / candidate | 105/117 (89.74%) | 83 / 3 | 31 | 83/86 (96.51%) | 83/117 (70.94%) | 23/100 (23.00%) |
| Validation / active baseline | 90/117 (76.92%) | 47 / 6 | 64 | 47/53 (88.68%) | 47/117 (40.17%) | 10/100 (10.00%) |
| Benchmark / candidate | 179/192 (93.23%) | 133 / 3 | 56 | 133/136 (97.79%) | 133/192 (69.27%) | 36/200 (18.00%) |
| Benchmark / active baseline | 144/192 (75.00%) | 90 / 3 | 99 | 90/93 (96.77%) | 90/192 (46.88%) | 27/200 (13.50%) |

HELLO archived-pose validation: candidate 2/2 top-1 correct and 2/2 accepted correct; baseline 2/2 top-1 correct and 1/2 accepted correct. HELLO benchmark: candidate **6/7 top-1 correct and 6/7 accepted correct**, versus baseline **4/7 top-1 correct and 3/7 accepted correct**. Neither model accepted an incorrect label among these actual HELLO clips. This per-class statement does not count other or unknown words falsely predicted as HELLO.

Validation stress conditions reuse the same recordings. Candidate unknown false acceptance remained 21–23%; stride-three phases 0 and 2 reduced known precision to 92.68% and 92.41%. Phase 2 retained 2/2 HELLO top-1 predictions but accepted neither. These are correlated robustness checks, not additional independent test recordings.

## Browser replay and numerical parity

Four public source videos were selected by lexicographic official clip identity before predictions: **two existing training HELLO videos and two official-test videos**. They supplement the pose study with an extraction diagnostic; the two training videos provide no held-out accuracy evidence. The separate existing HELLO validation reference MVI_9917 was not used for fitting and is not one of these four replay files.

Each file was SHA-256 checked against the [local reference manifest](C:/Users/adjay/Downloads/signbridge/.training-data/camera-study-references-2026-10-11/manifest.json). Source downloads used bounded ZIP ranges, checked member CRC32 and re-read saved hashes. Full source-video ZIP MD5s were not verified; locally computed per-video hashes do not imply an upstream per-video checksum.

The actual current app Tasks Holistic CPU VIDEO loader extracted sequential decoded frames at 125 ms source timestamps, with a fresh tracker per video/geometry. Original 1920×1088 and aspect-preserving letterboxed 640×480 views produced **eight correlated conditions from four videos**, not eight independent clips. Both models used the same extracted frames and the app's quality/acceptance path. All eight camera quality gates passed. Ground truth never entered inference; replay produced scalar reports without speech or messages.

| Public source recording | Split; frames per view | Candidate original / 640×480 | Baseline original / 640×480 |
|---|---|---|---|
| Greetings/48. Hello/MVI_0032.MOV | Train; 20 | HELLO 0.936810 rejected / HELLO 0.871909 rejected | GOOD MORNING 0.843088 rejected / COURT 0.308460 rejected |
| Greetings/48. Hello/MVI_0037.MOV | Train; 16 | HELLO 0.991648 accepted / HELLO 0.954914 accepted | HELLO 0.977248 accepted / IT 0.510634 rejected |
| Greetings/48. Hello/MVI_0029.MOV | Official test; 21 | **HELLO 0.830931 rejected / HELLO 0.904577 rejected** | GOOD MORNING 0.694350 rejected / COURT 0.308334 rejected |
| Greetings/55. Thank you/MVI_0006.MOV | Official test; 17 | **THANK YOU 0.986417 accepted / THANK YOU 0.993542 accepted** | THANK YOU 0.765701 rejected / TEACHER 0.310398 rejected |

The candidate recognized THANK YOU correctly in both test-video views, but its HELLO test-video score stayed below 0.95 in both. No accepted wrong label occurred on the selected test references. Dataset HELLO improvement therefore does not demonstrate a working webcam HELLO feature. Replay is not measured real-time throughput, a participant trial, or an estimate of general live accuracy.

The [Python/JavaScript numerical check](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/browser-numerical-parity.json) used three real validation fixtures. Maximum feature error was **5.311331983115508e-7** and maximum probability error **3.930998280360365e-8**, below the 1e-5 tolerance. An all-missing synthetic detection fixture was rejected before inference. These checks establish numerical/quality-gate behavior, not idle-camera or recognition accuracy.

## Promotion decision and next work

The preset known precision ≥95% and correct coverage ≥60% screens passed on both primary splits. Promotion still fails for four measured reasons:

1. Unknown validation false acceptance is 23%, exceeding the fixed ≤5% limit.
2. Unknown benchmark false acceptance is 18%, exceeding the fixed ≤5% limit.
3. Unknown rejection regresses versus the baseline: 10%→23% validation and 13.5%→18% benchmark false acceptance.
4. The separately replayed HELLO test video is not accepted correctly in either geometry.

The [recorded decision](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/decision.json) retains the active model byte-for-byte. The candidate remains local research only, with promoted=false; no weights were installed into the app or public deployment. Retention is not a claim that the old model is reliable: its unknown acceptance and coverage also fail the fixed screens. Correct THANK YOU acceptance in both geometries is an additional diagnostic, not a promotion requirement added after seeing results.

Next work requires independently recorded, consented signing from fluent ISL users, with available signer identities, camera/distance/lighting variation, and separate training/validation/untouched evaluation groups. Collect genuine idle, incomplete signing, ordinary motion and words outside the supported vocabulary. Train and validate explicit rejection/unknown handling on the development data, then freeze its policy before a new independent evaluation. Do not lower gates or tune against these already examined references. Resolve archive-versus-current-detector differences using labelled source-video extraction, and measure actual webcam capture, latency and text/voice behavior separately. Continuous sign sentences, facial grammar and broad regional coverage remain outside this isolated-word study.

## Records and reproduction

Local study directory: [camera-aligned-isl-2026-10-11](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11). Raw videos, poses and candidate weights remain in ignored research directories. The workspace copy of the [browser replay JSON](C:/Users/adjay/Downloads/signbridge/docs/camera-candidate-browser-replay-2026-10-11.json) contains scalar diagnostic evidence and exactly matches the local replay file. An [actual browser result screenshot](C:/Users/adjay/Downloads/signbridge/docs/camera-training-browser-results-2026-10-11.jpg) accompanies it.

| Artifact | SHA-256 |
|---|---|
| [candidate.json](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/candidate.json) | a77f33b3f0d2ca7570b041e4cf93fa1ee3374efc6e974cb975ae80f587041004 |
| [protocol.json](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/protocol.json) | 29c44cb357ee67a45e8b6f5b24fa8eb4db2f4413df15ec2553597bd491e10d13 |
| [validation.json](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/validation.json) | 183a4069715dd82c76be309e5fd036ca5df9dca60fcfe5d6244ef3db543fa6e2 |
| [benchmark.json](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/benchmark.json) | d0f9064833c44056981d19a5f6bbea8ba706719daec52f8dc1980d25ad0d8e5f |
| [browser-replay.json](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/browser-replay.json) and its docs copy | 012957885960a1f485c11987c6e6e2e1a492b3d763cda37a750aff90256424d2 |
| [browser-numerical-parity.json](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/browser-numerical-parity.json) | 010d40cdaaab013f00cf2880982aeec5d65383d8d220d7be3272c41b5c54b220 |
| [Active baseline](C:/Users/adjay/Downloads/signbridge/public/models/isl.json), unchanged | 55c23fffe387944a102c804676ae91aa7276781d598b7adaf03f0115234acdd9 |

The [run](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/run.json), [preparation](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/preparation.json) and [freeze](C:/Users/adjay/Downloads/signbridge/training/artifacts/camera-aligned-isl-2026-10-11/frozen-candidate.json) retain fitting history, counts and immutable source hashes, including runner, preprocessor and decision protocol. Freeze-time finalTestEvaluated=false records the state before the later benchmark; the separate benchmark file records the completed evaluation.

Recorded commands, run from C:/Users/adjay/Downloads/signbridge in PowerShell:

~~~powershell
$study = 'training/artifacts/camera-aligned-isl-2026-10-11'
./.training-venv/Scripts/python.exe -B training/camera_aligned_study.py --check-only
./.training-venv/Scripts/python.exe -B training/camera_aligned_study.py --output $study --seed 42 --epochs 120 --max-seconds 600 --threads 4
node training/check-camera-candidate-parity.mjs $study "$study/browser-numerical-parity.json"
./.training-venv/Scripts/python.exe -B training/camera_aligned_study.py --evaluate-study $study
npm test
npm run test:ui
./.training-venv/Scripts/python.exe -B -m unittest discover -s training -p 'test_*.py'
npm run build
npm run build:public
~~~

These are provenance/reproduction commands, not instructions to overwrite this run. Fitting requires a fresh output directory; benchmark evaluation refuses a second report. Browser replay used [compareCameraCandidate](C:/Users/adjay/Downloads/signbridge/scripts/compare-camera-candidate.browser.js) in the local development browser with the four explicitly selected File objects and both pinned model files; it is not a CLI webcam test.

Final engineering verification: **367 Node tests, 500 UI tests and 191 Python tests passed**. Both **npm run build** and **npm run build:public** completed with exit code 0; the public output contains no dist/models directory. The original active model SHA-256 remains unchanged. Automated engineering fixtures are not counted as sign-recognition examples.
