# Experimental LSTM control — 8 October 2026

A training-only LSTM75 comparison is implemented. It uses SignBridge's existing normalized body/hand landmark contract, so a future experiment can compare GRU75 and LSTM75 on the same vocabulary, inputs and recorded signer groups. No real sign training was performed, no weights were replaced and no model was promoted.

The [full external repository assessment](external-lstm-full-analysis-2026-10-08.md) identified useful temporal-landmark concepts, conflicting original labels, dependency conflicts and incompatible bundled model files. This implementation is newly written in the existing PyTorch pipeline; no external notebook source, dependencies or binary model were copied.

## Implemented scope

- `training/graph_models.py` adds an experimental `lstm75` registry and a one-layer, 64-unit LSTM. It consumes the same masked, normalized `32×75×3` x/y/confidence features as GRU75. It performs temporal sequence learning, not graph convolution. Parameter counts differ and are recorded.
- Historical `ARCHITECTURES`, frozen graph CLI defaults and existing protocols remain unchanged. The historical training profile rejects LSTM75.
- `training/train_temporal_baseline.py` is a separate command for GRU75/LSTM75 controls with three fixed seeds, shared bounded training settings and fresh output directories.
- The runner records source/metadata fingerprints, the exact ordered-label hash, shared recipe and signer-group checks before fitting. Training signer codes cannot overlap either known or unknown validation codes.
- Reports mark the study experimental, local research only, unpromoted and acceptance disabled. Recorded codes cannot independently verify physical people; the command does not inspect final-test features or final-test signer groups.

## Prerequisites and usage

A new prepared pose75 NPZ and matching `.metadata.json` are required. They must contain the expected train, known-validation and unknown-validation arrays, exact ordered labels and valid `signer_ids_train`, `signer_ids_val`, `signer_ids_unknown_validation`. Supplied labels need fluent review and appropriate recording consent/rights. The mere existence of signer codes does not prove an independent-person evaluation.

Example only, from the project directory:

```powershell
.\.training-venv\Scripts\python.exe training\train_temporal_baseline.py `
  --language asl `
  --data .training-data\new-study\asl.pose75.npz `
  --output training\artifacts\temporal-study-v1
```

The example paths do not establish that a usable dataset exists. The command would fit models if run with valid data; it was not run on real sign data during this implementation. It never calibrates, exports a public artifact, promotes a candidate or changes application weights. Do not amend old frozen studies to include this architecture.

## Declared coordinate provenance — 9 October 2026

New temporal studies now require explicit `coordinateProvenance` in the prepared `.metadata.json`. The historical graph loader, frozen studies and old data remain unchanged. This gate follows the [measured archive/camera coordinate mismatch](recognition-replay-2026-10-09.md); it does not train a replacement model or implement a new canonical data preparer.

Run the narrow read-only check before attempting a new study:

```powershell
.\.training-venv\Scripts\python.exe training\train_temporal_baseline.py `
  --language isl --data .training-data\new-study\isl.npz --check-only
```

`--output` is unnecessary for this command. It imports neither PyTorch nor NumPy, never decodes feature arrays and never creates output files or directories. It bounds metadata to 1 MiB and the prepared source to 512 MiB; declared sources are hashed in bounded chunks. Success checks the declaration and its binding to the prepared file only. It explicitly reports that feature arrays, signer groups, original conversion, audit-report contents and browser parity have not been verified. Failure exits nonzero with an actionable error and no traceback. Unannotated sources fail before their NPZ file is hashed.

The exact versioned schema below belongs inside the prepared metadata. The hash strings are placeholders, not valid fingerprints. Use this schema only for a **new dataset whose raw XY conversion was actually applied before shoulder normalization**; never add it to historical arrays to bypass the gate.

```json
{
  "coordinateProvenance": {
    "format": "signbridge-temporal-coordinates-v1",
    "canonicalSpace": "normalized-image",
    "axes": "x-right-y-down",
    "cameraSpace": "normalized-image",
    "conversionStage": "before-shoulder-normalization",
    "source": {"space": "normalized-image", "scaleX": 1, "scaleY": 1},
    "conversion": "identity",
    "preparedDataSha256": "<lowercase SHA-256 of the newly prepared NPZ>",
    "auditReportSha256": "<lowercase SHA-256 reference to its coordinate audit report>"
  }
}
```

For an explicitly audited uniform axis-scaled source, `source.space` is `axis-scaled-image`, the integer `scaleX`/`scaleY` values are the actual XY divisors, and `conversion` is `divide-xy`. Each divisor must be 1–16384 and at least one must exceed 1. Normalized sources require both divisors to equal 1 and `identity`. Additional/missing schema fields, unknown axes, mixed source conventions and inconsistent conversions are rejected. Axes and divisors are never inferred from language, a model hash, image shape or label. The audit-report hash is a reference; its existence and contents are not independently inspected or treated as proof.

Ordinary training runs the same gate before loading arrays or dispatching fitting, retains existing feature/label/signer checks and source-change checks, and freezes the exact declaration into `experiment.json` with `coordinateConversionIndependentlyVerified: false`. A passing coordinate preflight cannot establish that the complete training command will pass its separate checks.

Current local ISL and strict ASL graph datasets both lack this declaration and remain blocked. ISL additionally has missing (`-1`) signer identities in all learning splits. ASL has recorded signer codes, but its source convention requires an independent audit; do not copy the separately audited ISL scaling into ASL. No current dataset, model weights, normalization arrays, thresholds or frozen study was modified or fitted by this change.

The updated temporal suite passed **21 engineering tests**, and the complete Python suite passed **166 tests** on 9 October. Checks cover the exact schema/conversion relationship, changed-data hash binding, bounded malformed metadata, legacy rejection before array loading/fitting/output creation, unchanged check-only source bytes, protocol recording and a subprocess that rejects any PyTorch import. A plain subprocess using fresh isolated module/input directories verifies that success and rejection create no files, directories or bytecode caches. The actual existing ISL preflight exited **2** with the expected actionable rejection and no traceback. No optimizer fitting or real sign-accuracy evaluation was performed. Existing ONNX export/tracing warnings remain.

## Verification and remaining work

The complete Python suite now passes **166 tests**, including the fourteen original LSTM engineering tests and seven added coordinate-preflight tests. Tests cover input masking, finite outputs/gradients, deterministic evaluation, batch independence, checkpoint label order, signer overlap rejection, protocol isolation, coordinate declarations and freezing before dispatch. Dispatcher tests mock fitting; no optimizer fitting run was executed.

Synthetic untrained LSTM ONNX export and native CPU probability/top-label parity passed the existing error limit on fixed batch-one, thirty-two-frame fixtures. Legacy-export, tracing and recurrent-batching warnings were emitted. This is narrow engineering evidence; it does not establish Web WASM/Chrome compatibility, camera speed or sign accuracy.

Before a model can be considered for app use, collect/review authorized data, freeze a separate evaluation and acceptance protocol, compare useful correct coverage and unknown/nonsigning false accepts, check export/browser parity and complete real Windows/Android trials. No claim that LSTM will outperform GRU or ST-GCN is justified yet. Continuous sign-language translation and arbitrary speech/text-to-sign generation remain separate work. Public builds continue to exclude research models.

## Historical public pilot status — 8 October 2026

On 8 October, the application source and deployment shortcut were published on `codex/render-pilot`; the working laptop history and unpublished test captures were preserved separately. **595 application checks and both builds passed** before the original training-only addition. Render deployment was still pending at that point. The pilot was subsequently deployed on 9 October; that deployment does not include research recognition weights. These new coordinate-preflight changes are local pending publication and do not establish a new deployment or physical two-device acceptance. See the [9 October reference improvements and current scope](isl-reference-improvements-2026-10-09.md).
