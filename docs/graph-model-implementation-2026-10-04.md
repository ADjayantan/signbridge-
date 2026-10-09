# Joint-model implementation — 4 October 2026

The core research pipeline and application integration are implemented. All 18 planned primary training runs and six additional matched ASL signer-study runs completed. **No new model passed the release gates, so none replaced the app's existing experimental weights.** Actual camera, audible speech, Android and fluent-user trials are pending.

## Implemented

- Rebuilt ISL/ASL recordings as 32 frames × 75 body/hand joints × x/y/confidence, retaining every original clip and split. No face/depth features or fabricated timestamps.
- Versioned anatomical adjacency, nearest-frame resampling, missing-joint masks and valid-training-only coordinate normalization. Confidence remains unstandardized; ONNX performs normalization exactly once.
- Three architectures × three seeds × two languages: GRU27 control, full-joint GRU64, compact graph-temporal network. Identical optimization ceilings; graph CPU refinements were recorded before full graph learning.
- Validation-only checkpoint selection and rejection calibration, frozen selection, one confirmatory historical test report, counts, per-word confusions and Wilson intervals. Files refuse silent overwrite and comparison verifies source/checkpoint hashes.
- PyTorch → ONNX → single-thread ONNX Web WASM module worker, pinned/self-hosted runtime assets, artifact integrity/schema/language checks, bounded inference and stale-generation cancellation.
- Connect and Sign Workspace offer an explicit **Word recognition model** choice. The new 75-joint option loads only promoted artifacts. Unavailable models preserve tracking, typing and reviewed messages; no automatic model/language/AI substitution.
- Async Finish → review/edit → explicit text/voice controls; cancellation, camera loss, model/language changes and unmount discard late recognition. Borrowed call-camera tracks remain owned by room media.
- Public builds exclude all research model files, the standalone server blocks the entire `/models` path, public hooks return before fetching cached research weights, and runtime-cache policy uses NetworkOnly for public model requests.
- Prepared an optional ASL signer-separated study and a separate strict-negative variant. The strict variant retains 1,202/373/450 known train/validation/test clips from 67/14/15 signers; it has 40 calibration negatives and 112 test negatives after excluding 148 clips from training signers. Training, selection and calibration signer identities have zero overlap with final test identities. One unknown word occurs in both holdouts; these are not idle-camera negatives. Six fresh matched GRU27/GRU75 runs were trained and evaluated on the strict variant. The earlier variant retaining historical negatives remains untrained. [Strict study results](graph-model-evaluation/asl-signer-study-2026-10-04/README.md).
- Workspace now waits for measured camera frames before Capture, labels tracking paused after two seconds without new frames and disables only new captures. Finish/Cancel, review, drafts and camera ownership remain usable, including pending-recognition cancellation and fresh-frame recovery.

## Measured outcome

See the [full frozen experiment report](graph-model-evaluation/2026-10-04/README.md).

| Historical test, three-seed mean | GRU27 control | Full-joint GRU | Compact graph |
| --- | ---: | ---: | ---: |
| ISL top-1 before rejection | 74.1% | 89.6% | 53.5% |
| ASL top-1 before rejection | 39.9% | 42.2% | 14.6% |
| ISL correctly accepted coverage | 16.3% | 26.2% | 13.2% |
| ASL correctly accepted coverage | 3.1% | 3.1% | 0.0% |

Top-1 improvement does not establish safe automatic translation. None met the all-seed validation target of at least 60% correctly accepted coverage with at least 95% accepted-known precision and at most 5% unknown false accepts. The new joint models remain local offline candidates. Current experimental app weights are retained, including their previously documented limitations.

Full75 versus legacy27 changes resampling, validity and normalization as well as joints. Graph versus full75 GRU uses the same arrays/statistics. This experiment supports the full feature-contract upgrade for ISL, not a universal conclusion that graph models are worse. The compact graph has less capacity and ASL runs reached the CPU wall-clock ceiling. No final-test-driven architecture or threshold revision was made.

Python/JavaScript preprocessing matched exactly on six real archived validation recordings plus synthetic edge cases. All four trained representative exports matched PyTorch probabilities within `1e-4`, with identical labels and calibrated acceptance. Warm Node WASM p95 was 1.06/5.50 ms for ISL GRU/graph and 0.65/5.59 ms for ASL, measured over 50 iterations each. These are prepared-tensor classifier measurements, not browser camera latency. [Runtime evidence](graph-model-evaluation/2026-10-04/runtime-parity.json).

## Verification

- `npm run check`: 231 Node tests and 237 UI tests passed, followed by the ordinary production/PWA build (468 application checks total).
- Python discovery: 115 tests passed, including preparation, masking, training/export, evaluation, selection, preregistration and signer-study comparison checks.
- `npm run build:public`: passed after source checks. The final `dist` has no `models` directory and no ONNX, PyTorch, NPZ or pickle research artifacts. Matching self-hosted ONNX runtime assets are present; public model requests use NetworkOnly caching.
- Original ISL/ASL archives, prepared arrays, metadata and deployed model hashes all still match the frozen protocol. Ignored local research paths remain ignored.
- Actual camera, audible speech, Chrome/Android timing and fluent-user recognition are unverified. [Device run sheet](graph-model-device-trials-2026-10-04.md) records the remaining trials without treating automated checks as device evidence.

## Additional signer study

The separate strict ASL comparison gives 28.1% mean test top-1 for the newly trained matched GRU27 control and 27.1% for full-joint GRU. Correctly accepted coverage averages 0.74% and 0.59%, respectively. These are different signer/split assignments and must not be compared directly against the primary 39.9%/42.2% scores as a controlled improvement/regression. No eligible architecture was selected by validation; the one final comparison retained that decision. All six checkpoints and protocols were checked before final inference. [Protocol, per-seed evidence and limits](graph-model-evaluation/asl-signer-study-2026-10-04/README.md).

## Reproduction

The completed data/checkpoints are already on this laptop. Do not rerun immutable output paths. Use new directories/report filenames for a new independently documented experiment.

```powershell
.\.training-venv\Scripts\python.exe -m pip install -r training/requirements-graph.txt
.\.training-venv\Scripts\python.exe training/prepare_graph_data.py --language both --output-root .training-data/new-graph-study
.\.training-venv\Scripts\python.exe training/train_graph_models.py --language isl --data .training-data/new-graph-study/isl/isl.npz --output training/artifacts/new-study/isl
.\.training-venv\Scripts\python.exe training/train_graph_models.py --language asl --data .training-data/new-graph-study/asl/asl.npz --output training/artifacts/new-study/asl
.\.training-venv\Scripts\python.exe training/compare_graph_experiment.py --run-root training/artifacts/new-study/isl --selection training/artifacts/new-study/isl-selection.json
.\.training-venv\Scripts\python.exe training/compare_graph_experiment.py --selection training/artifacts/new-study/isl-selection.json --final-report training/artifacts/new-study/isl-final.json
```

Run the same selection/final commands for ASL. The graph export command accepts a completed run and its frozen `calibration.json`; `training/check-onnx-parity.mjs` checks the resulting ignored validation fixtures without enabling the model.

```powershell
node training/check-onnx-parity.mjs --exports-root training/artifacts/graph-v1/final-exports-2026-10-04 --report training/artifacts/new-runtime-report.json
.\.training-venv\Scripts\python.exe -m unittest discover -s training -p 'test_*.py' -q
npm run check
npm run build:public
```

`npm run dev` and both build scripts prepare the exact ONNX runtime companion assets automatically. Recognition does not require Gemini, Render or a paid service. `.training-data`, checkpoints, raw parity fixtures, `public/models` and generated runtime files remain ignored.

## Remaining work

The new 75-joint option intentionally shows unavailable until a candidate passes evaluation and has an actual device-runtime report. There is no browser or fluent-user promotion report yet. Manual camera/device trials must be recorded separately from automated tests; browser automation access is currently blocked and was not bypassed.

The next research experiment should improve training/generalization and uncertainty/unknown rejection, using fresh validation rather than repeatedly adjusting against either test. The strict ASL signer study has now been trained and evaluated; its small negative holdouts have substantial statistical uncertainty. Collect genuine nonsigning negatives and fluent signing trials with explicit consent. Guiding automatic turn completion, facial/nonmanual features and continuous sentence translation remain later work. Earlier installed-PWA research-cache migration has not been physically exercised.

Local website startup was rejected by automatic tool approval review with only “blocked by policy” as the stated reason. No alternative startup or browser-inspection method was used, and no running/opened website is claimed from this continuation.

The existing reviewed-message, typing, natural signing video and voice paths remain the demo fallback. Sign recognition and translation quality must be described as experimental.
