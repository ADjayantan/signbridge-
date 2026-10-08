# Twelve-word ASL validation pilot — 5 October 2026

This is **reused validation/model-selection evidence only**. Final test arrays were not read, no model was promoted or exported, and live-camera correctness remains unmeasured.

Training-only vocabulary: DRINK, FINISH, FAMILY, WHO, BIRD, BOOK, GO, HOT, FINE, BROWN, EAT, WHAT.

Selected training: 198 clips from 39 signer codes; selected validation: 39 clips. Genuine OOV validation: 40 clips. Excluded known words: 334 validation clips, treated separately as unsupported signs.

| Arm | Seed | Macro recall | Accepted-known precision | Correct-known coverage | Genuine OOV FAR | Excluded-known FAR | Fixed gates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | 42 | 71.5% | unavailable (none accepted) | 0.0% | 0.0% | 0.0% | fail |
| none | 43 | 61.2% | unavailable (none accepted) | 0.0% | 0.0% | 0.0% | fail |
| none | 44 | 62.1% | 100.0% | 5.1% | 5.0% | 4.8% | fail |
| mild-spatial | 42 | 75.0% | 100.0% | 2.6% | 2.5% | 4.8% | fail |
| mild-spatial | 43 | 67.5% | unavailable (none accepted) | 0.0% | 0.0% | 0.0% | fail |
| mild-spatial | 44 | 72.1% | 100.0% | 2.6% | 2.5% | 4.5% | fail |

Decision: **no variant passes all fixed validation gates**. Research follow-up candidate: none.

The confidence/margin grid and four gates were frozen before training; no per-word thresholds, vocabulary replacement, iterative tuning or seed cherry-picking were used. Rejection can improve apparent precision while making correct coverage too low. Review exact counts and Wilson intervals in summary.json, and per-word counts/confusions in the CSV files.

## Limits

- Reused validation is model-selection data, not fresh test or release evidence.
- The underlying historical corpus has already been inspected; no new final test is claimed.
- Original strict signer groups and final test identity commitments are retained.
- No final test features, targets or predictions are read by this pilot.
- No idle-camera negatives, live devices, fluent-user review, facial features or continuous sentences.
- Small correlated validation samples do not establish a population false-accept bound.
- Mild spatial augmentation is a research hypothesis, not linguistically validated sign generation.
- No threshold tuning after these fixed runs, promotion, export or public-build changes.
