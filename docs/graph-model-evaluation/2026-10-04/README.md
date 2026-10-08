# Joint-model experiment — 4 October 2026

**18 seeded training runs completed. No candidate passed promotion; app research weights remain unchanged.**

Three architectures, seeds42/43/44, identical80-epoch/1200-second ceilings, validation-based early stopping and calibration. Test was evaluated after frozen selection. Profiling/untrained spikes are excluded. Historical test recordings were previously inspected; these are not new live or unfamiliar-signer accuracy measurements.

| Language | Model | Test top-1 mean (seed range) | Correctly accepted known coverage, mean | Unknown false accepts, seeds42/43/44 |
| --- | --- | --- | --- | --- |
| ISL | gru27 | 74.1% (71.9%–76.0%) | 16.3% | 20 / 6 / 9 of200 each |
| ISL | gru75 | 89.6% (88.5%–90.6%) | 26.2% | 6 / 4 / 10 of200 each |
| ISL | stgcn | 53.5% (50.5%–56.2%) | 13.2% | 15 / 6 / 9 of200 each |
| ASL | gru27 | 39.9% (38.4%–40.8%) | 3.1% | 1 / 5 / 1 of200 each |
| ASL | gru75 | 42.2% (39.6%–45.5%) | 3.1% | 1 / 1 / 1 of200 each |
| ASL | stgcn | 14.6% (12.2%–16.1%) | 0.0% | 0 / 1 / 4 of200 each |

Top-1 is measured before rejection. Accepted coverage includes only correct accepted known examples divided by all known examples. Seed predictions share the same clips and must not be pooled as independent observations. Per-seed known precision, negative-mixture precision, counts and Wilson95 intervals are in the final JSON reports.

The full-joint temporal model improves ISL top-1, but strict rejection leaves too little coverage. ASL remains weak. The compact graph candidate is worse than the full-joint GRU in this bounded experiment; this is not a conclusion about all graph models. Every architecture failed the preregistered all-seed validation60% correct-coverage screen, so no winner was selected and none was promoted.

Legacy27→full75 changes joint coverage, nearest versus linear resampling, confidence validity and masked coordinate normalization together. Attribute that result to the full feature-contract upgrade. Graph versus full75GRU uses identical feature arrays and statistics. The graph is smaller (12,785ISL /16,100ASL parameters), uses depthwise temporal strides1/2/2, and all3ASL graph runs hit the recorded wall-clock ceiling at epoch boundaries; those constraints limit conclusions.

## Evidence

- [Frozen protocol](experiment.json), [CPU budget amendment](budget-amendment.json), [pretraining architecture amendment](architecture-amendment.json).
- [ISL selection](isl-selection.json), [ASL selection](asl-selection.json).
- [ISL final benchmark](isl-final.json), [ASL final benchmark](asl-final.json).
- [All18 run metrics](runs.csv), [per-word results](per-word.csv).
- [Real-pose feature parity](../feature-parity-2026-10-04.json): three archived validation poses per language and synthetic edge cases; Python/JS raw and reference-normalized features matched exactly.
- [Trained ONNX/WASM parity and timings](runtime-parity.json): representative seed42GRU75/STGCN per language, three real validation fixtures each; calibrated decisions matched.

Single-thread Node WASM classifier timings are operator measurements, not Chrome camera/end-to-end latency. Actual camera, audible speech,20 lifecycle cycles, PWA cache migration, fluent interpretation and Android performance remain unverified. A [separate strict ASL signer study](../asl-signer-study-2026-10-04/README.md) subsequently completed six matched runs; it does not change these historical results or promote a model. The earlier signer variant retaining historical negatives remains untrained.

Weights, raw poses, validation fixture arrays and prepared data remain in ignored local research directories. Public builds exclude all /models artifacts; the standalone server refuses the entire path. No Gemini call is part of graph recognition.
