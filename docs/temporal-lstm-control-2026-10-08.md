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

## Verification and remaining work

The full Python suite passed **159 tests**, including fourteen new synthetic engineering tests. Tests cover input masking, finite outputs/gradients, deterministic evaluation, batch independence, checkpoint label order, signer overlap rejection, protocol isolation and freezing before dispatch. Dispatcher tests mock fitting; no optimizer fitting run was executed.

Synthetic untrained LSTM ONNX export and native CPU probability/top-label parity passed the existing error limit on fixed batch-one, thirty-two-frame fixtures. Legacy-export, tracing and recurrent-batching warnings were emitted. This is narrow engineering evidence; it does not establish Web WASM/Chrome compatibility, camera speed or sign accuracy.

Before a model can be considered for app use, collect/review authorized data, freeze a separate evaluation and acceptance protocol, compare useful correct coverage and unknown/nonsigning false accepts, check export/browser parity and complete real Windows/Android trials. No claim that LSTM will outperform GRU or ST-GCN is justified yet. Continuous sign-language translation and arbitrary speech/text-to-sign generation remain separate work. Public builds continue to exclude research models.

## Public pilot status

The application source and deployment shortcut are published on `codex/render-pilot`; the working laptop history and unpublished test captures were preserved separately. **595 application checks and both builds passed** before the training-only addition; application runtime source is unchanged by that addition. The full training suite above covers the new Python changes. Render account/service access, actual HTTPS deployment, relay configuration and physical two-device acceptance remain pending. A pushed GitHub branch or queued browser tab is not a deployed service.
