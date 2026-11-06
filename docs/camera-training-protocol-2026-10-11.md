# ISL camera-aligned training protocol — 11 October 2026

This is a local research experiment responding to the request to find labelled sign videos and retrain. It is not evidence of a working live translator. The candidate has not been fitted when this protocol is written.

## Data and rights

Use the [official INCLUDE dataset](https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md), attributed to Advaith Sridhar, Rohith Gandhi Ganesan, Pratyush Kumar and Mitesh Khapra (ACM Multimedia 2020), under CC BY 4.0. Actual source videos are distributed through [Zenodo](https://zenodo.org/records/4010759). The Hugging Face files contain labels and paths, not video bytes. Existing video-derived poses come from the [OpenHands pose record](https://zenodo.org/records/6674324); verify its published INCLUDE archive length and MD5 before reading bounded numeric members.

Keep the existing OpenHands-derived clip membership: 49 words, 628 training clips, 117 validation clips, 192 benchmark-test clips, 100 unknown-validation and 200 unknown-test clips. Do not silently substitute the newer Hugging Face splits. The benchmark test has been examined in previous experiments, so it is a regression benchmark, not a new blind test. All available ISL signer codes are unknown; no signer-independent claim is possible.

The known HELLO reference `Greetings/48. Hello/MVI_9917.MOV` is validation data and stays outside training. Select two additional HELLO training videos and HELLO/THANK YOU test videos using lexicographic official clip identity, before obtaining predictions. Record member CRC, computed video SHA-256, URLs and exact split membership. Partial ZIP downloads cannot establish the full archive's checksum.

## Candidate and comparison

- Re-read original poses. Convert archived x/1080 and y/1920 before shoulder normalization, clipping or interpolation. Never relabel previously clipped features as canonical.
- Train the existing browser-compatible GRU27 architecture with normalized-image camera input, preserving the 49-word label order. Declare the new input contract explicitly. Leave the active model and all old prepared arrays untouched.
- Use deterministic seed 42, four CPU threads, a bounded training run, training-only mild aspect variation and frame-index sparsity. Archive poses lack verified per-frame timestamps; stride augmentation is not measured eight-Hz footage. No mirroring, reversal, invented labels or repeated fabricated frames.
- Fit normalization using training only. Choose the checkpoint using validation macro recall, breaking an exact recall tie by lower validation cross-entropy loss. Unknown validation may be reported but cannot enter fitting or checkpoint selection. Test inference is a separate operation after the exported candidate hash is frozen.
- Fix score acceptance at 0.95 and margin at 0.30 for both candidate and existing model. Report top-one accuracy, accepted correct/wrong, correct coverage, accepted precision, unknown false accepts, and HELLO results. A classifier score is not calibrated real-world correctness.
- Compare current browser Tasks extraction on the same SHA-pinned public source files, at sequential 125 ms source timestamps, in original geometry and aspect-preserving 640×480. These correlated conditions are stress tests, not independent clips or measured real-time speed. Ground truth remains report metadata and never enters inference.

## Promotion decision fixed before training

Do not replace the active model on top-one accuracy alone. Minimum research screening requirements are accepted known precision ≥95%, correct known coverage ≥60%, and unknown-word false acceptance ≤5% on validation and the separate historical test benchmark. The candidate must not regress the current model on the same primary benchmark measures, and must recognize the separately replayed HELLO test video correctly without an accepted wrong label on the other selected test reference.

These screening conditions still do not establish live reliability. No idle-camera negative corpus, held-out signer trial or fluent-person webcam trial is available. A candidate that meets dataset screens may be offered explicitly as an experimental local candidate; a public automatic-translator release remains unsupported. If screening fails, retain the original active model and explain the measured failure. Never edit acceptance booleans or confidence gates to make the demo speak.

## Required records

Keep source hashes, immutable split identities, training configuration/seed/duration, candidate hash, parity errors, scalar browser replay reports and the promotion decision. Keep raw videos, poses and weights in ignored local research directories. Public builds continue to exclude them. Dataset accuracy, browser reference replay and real-user webcam text/voice results must be reported separately.
