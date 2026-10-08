# Camera capture quality — 5 October 2026

The legacy camera path now checks measured capture timing and joint visibility before evaluating learned weights. These checks reuse the existing graph camera rules. They do not change model weights, learned vocabulary, preprocessing, normalization or rejection thresholds.

## Confirmed defect

The archive predictor counted hand-visible and shoulder-visible frames separately. It could reach inference with four hand-only frames and four shoulder-only frames even when no frame contained a hand and both shoulders together. Camera callers also omitted their measured duration when invoking the legacy model, so an initial, internal or trailing tracking gap was only a descriptive hint.

Two synthetic reproductions demonstrate the defect without using a person's video or the final test corpus:

- Eight frames with four hand-only and four shoulder-only observations produced `qualifiedFrames: 0` but still reached the archive predictor's strongly biased synthetic model.
- Four good observations at 0, 125, 250 and 375 milliseconds in a three-second capture reached inference despite a 2,625-millisecond trailing tracking gap.

These examples expose the capture-validation defect. The synthetic model's BOOK label is only a test fixture; it is not evidence that a real BOOK sign was recognized.

## Camera boundary

The camera wrapper requires the actual capture duration, rather than silently treating the final sample timestamp as the end of the turn. Both camera screens pass that duration. Its fixed rules are:

- Four to one hundred finite pose samples, with strictly increasing measured timestamps.
- Duration from 0.35 to 12 seconds, at least as long as the final measured sample.
- At least four observations containing a hand and both shoulders together.
- No initial, internal or trailing sampling gap longer than one second.

Failed checks return an empty, reviewable recapture result before word inference. Diagnostics say that inference did not run and keep the posterior absent. They retain only scalar observations and model metadata. The person can retry or manually enter a meaning; explicit speech and message addition remain available after that review. Passing checks preserve the archive predictor's probabilities, accepted/uncertain decision and rejection reasons.

`predictTrainedSign` remains unchanged for archive evaluations and numerical parity. Graph selection remains explicit and keeps its existing asynchronous predictor; unavailable graph weights never fall back to the legacy model. The new helper imports only pure model and camera-validation utilities, with no runtime allocation, camera access, network call or automatic upload.

## Verification and limits

Focused tests cover the original reproductions, missing/nonfinite duration, duration boundaries, missing/negative/repeated/regressing timestamps, sample limits, malformed poses, initial/internal/trailing gaps, scalar diagnostic snapshots and unchanged accepted/uncertain model decisions. Hook tests prove that rejected camera turns do not call learned inference. Room integration tests retain manual text, speech and message addition after rejection. Existing tracking cleanup and graph cancellation tests also pass.

The BOOK and DRINK user trials remain unresolved. This change rejects inadequate observations; it does not establish better sign recognition, unfamiliar-signer accuracy or continuous sentence translation. Live device tests and consented, correctly labelled trials are still required. No browser or camera inspection was performed for this change.
