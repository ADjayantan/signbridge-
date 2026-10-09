# Existing sign-to-text evaluation — 3 October 2026

The existing local ISL and ASL artifacts were evaluated afresh with the application's actual JavaScript classifier over **all 847 prepared held-out recordings**: 447 selected-vocabulary examples and 400 unknown-vocabulary examples. Every one of the **49 ISL and 100 ASL labels** had test examples. The model weights, prepared arrays, thresholds and metadata remained unchanged; their SHA-256 hashes are recorded in [summary.json](summary.json).

This is a **recording-level dataset test**, not a successful live-webcam signing trial. It does not exercise camera framing, landmark extraction, recording controls or sentence translation. Prepared poses have already passed dataset quality gates.

| Held-out result | ISL | ASL |
| --- | ---: | ---: |
| Known test examples | 192 | 255 |
| Examples per word | 1–9 | 1–5 |
| Top-1 correct before rejection | 144 (75.00%) | 104 (40.78%) |
| Accepted and correct | 90 | 22 |
| Accepted and wrong | 3 | 5 |
| Rejected known examples | 99 | 228 |
| Correct accepted coverage of known examples | 46.88% | 8.63% |
| Precision among accepted known examples | 96.77% | 81.48% |
| Words with at least one correct accepted example | 42 / 49 | 16 / 100 |
| Unknown examples incorrectly accepted | 27 / 200 (13.50%) | 9 / 200 (4.50%) |
| Existing confidence / margin thresholds | 0.95 / 0.30 | 0.98 / 0.30 |

The model is not limited to HELLO. Correct accepted ISL test predictions include BANK, BIRD, CAR, GOOD MORNING, THANK YOU and other words. The HELLO class itself had seven test examples: four top-1 predictions were correct, three were correctly accepted and four were rejected. Small per-word counts are not stable estimates of performance on future signing.

ISL had no correctly accepted example for ELECTION, PAINT, T-SHIRT, FAN, SUMMER, TEACHER or SMALL LITTLE. ASL had no correctly accepted example for 84 of its 100 classes. That makes ASL an experimental baseline with especially limited coverage at its current threshold. Review and correction remain necessary: the threshold does not guarantee correctness, and unfamiliar signs can still be accepted as known words.

The split limitations remain: ISL metadata does not provide signer IDs; 52 of ASL's 56 test signer IDs also occur in training. These results do not establish accuracy on unfamiliar signers or on spontaneous laptop signing. No model was retrained, and no data or weights were downloaded or redistributed.

The actual JavaScript probabilities were also compared with PyTorch using the same exported JSON weights for every held-out example. Matching JavaScript's float64 arithmetic gave maximum absolute errors of `2.0e-15` ISL and `3.6e-15` ASL, within the evaluation's `1e-10` tolerance. Reconstructing the pipeline in float32 gave maximum probability differences of `1.31e-5` and `4.42e-6`; top-1 predictions and accept/reject decisions were identical for all 847 examples. The earlier three-example parity tolerance is not claimed to bound every float32 result.

Per-word sample counts, errors, acceptance and common confusions are in [known-words.csv](known-words.csv). Unknown-vocabulary source counts and false accepts are in [unknown-words.csv](unknown-words.csv). Aggregate counts were checked: 149 word rows, 447 known examples, 400 unknown examples, and accepted-correct + accepted-wrong + rejected equals each known word's test count.

To repeat this evaluation from the repository root, use a new output directory. Existing reports are never overwritten:

```powershell
& .\.training-venv\Scripts\python.exe training/evaluate_heldout.py --language both --report-dir docs/model-evaluation-repeat
```

The command requires the existing local Python environment, Node.js, `.training-data/prepared/{isl,asl}.npz` plus metadata, and `public/models/{isl,asl}.json`. It calls inference only; it does not run training or change the application.
