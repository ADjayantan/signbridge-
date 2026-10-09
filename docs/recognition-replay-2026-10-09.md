# Recognition replay: 9 October 2026

An ISL training/camera coordinate mismatch was reproduced and corrected locally with an explicit model input contract. **The original HELLO video now produces an accepted HELLO on the realtime camera pipeline**, with unchanged learned weights and acceptance thresholds. This is a reference-video pipeline result; the requested webcam signer → partner text/voice conversation still needs real-user verification.

## What was implemented

Training Studio has a collapsed **Recognition diagnostics · check a reference video** panel in local builds. It accepts one local video, uses the existing pose conversion and unchanged word predictor, and optionally compares an offline baseline. The reference label is never supplied to inference.

The ordinary replay uses the same Tasks Holistic loader and options as the camera, capped at eight tracked samples per second. A separate sequential mode decodes samples at source timestamps; 25 samples/s is limited to four seconds/100 samples. It isolates sampling without changing the live recognizer. An explicitly selected older Solutions Holistic tracker is a separate compatibility experiment; it is not the current camera pipeline.

Both model and video bytes are SHA-256 checked before claiming that a baseline is comparable. Reports contain bounded scalar measurements, actual sampling/tracker identity, reasons for rejection and agreement flags. They exclude video, filenames, coordinates, personal identifiers, rooms and reviewed messages. Files and pose frames remain transient on the device. Replay neither sends messages nor calls AI, trains, stores recordings or speaks a prediction. Cancellation and late callbacks release the tracker without publishing stale results.

An explicit diagnostic coordinate experiment tests x×1080/y×1920 from the audited ISL archive. The ordinary camera path instead reads a validated coordinate contract from a versioned model artifact; people do not need to select a manual scale to use the corrected local model.

## Actual browser results

Two original **INCLUDE validation** videos were used, not final test partitions or synthetic sign fixtures. Both are 1920×1080 at 25 FPS. Archived poses were extracted with the older Solutions Holistic family. The existing 49-label ISL model, 0.95 score threshold and 0.30 margin were unchanged.

| Reference | Extraction and sampling | Tracked samples | Highest label/score | Accepted output |
|---|---|---:|---|---|
| HELLO | Archived Solutions poses, all frames | 49 | HELLO / 0.97993 | HELLO |
| HELLO | Browser Tasks, realtime camera path | 15 | IT / 0.19383 | None |
| HELLO | Browser Tasks, sequential 25 samples/s | 49 | IT / 0.21335 | None |
| HELLO | Browser Solutions experiment, sequential 25 samples/s, uncorrected coordinates | 49 | IT / 0.20469 | None |
| THANK YOU | Archived Solutions poses, all frames | 57 | THANK YOU / 0.94265 | None: below unchanged threshold |
| THANK YOU | Browser Tasks, sequential 25 samples/s | 57 | IT / 0.19444 | None |
| HELLO | Browser Tasks, sequential 25 samples/s, explicit archive-scale diagnostic | 49 | HELLO / 0.97847 | HELLO |
| THANK YOU | Browser Tasks, sequential 25 samples/s, explicit archive-scale diagnostic | 57 | THANK YOU / 0.72423 | None: below unchanged threshold |
| HELLO | Browser Tasks realtime, declared v2 model, default normalized input | 5 | HELLO / 0.97705 | HELLO |

All listed browser runs passed the existing hand/shoulder capture-quality gate. This alone establishes tracked joints, not understood sign language. Before correction, THANK YOU's top label differed from the archive. After correction it matches, but both results remain rejected; the new camera score is only 0.72423. No acceptance threshold was reduced. The realtime v2 run measured 1,897.7 ms and a largest sample gap of 418.5 ms; “8 Hz” is the existing sampling cap, not an achieved rate.

Archived HELLO poses downsampled to eight samples/s at four phase offsets retained HELLO as the top label; three were accepted and one rejected. Archived THANK YOU poses retained THANK YOU at all four offsets, again with three accepted and one rejected. Timing can affect acceptance, but these variants did not reproduce the browser's IT result. Denser browser sampling also failed, so removing the eight-Hz cap alone is not a demonstrated fix.

The Python-prepared and browser-prepared archived features agreed within 4.9e-7; their resulting posterior values agreed within 8.5e-8. This proves algorithm parity on the same numbers, but did not establish camera/archive coordinate compatibility. Switching to a pinned Solutions browser extractor alone also failed.

## Demonstrated coordinate mismatch and local correction

The archive actually stores pixel-like XY values and `vid_shape=(1080,1920)`, while the browser supplies normalized image coordinates. The prepared-data loader validates and discards `vid_shape`, so the old model artifact never declared this difference. A seven-joint first-frame comparison, spanning body and both hand wrists, matched archive x/1080 and y/1920 to browser coordinates with XY RMSE 0.0058; conventional x/1920 and y/1080 gave 0.3687. Browser decoding reports 1920×1088; its padded height was not substituted for the archived shape.

Changing only the archived HELLO coordinates to normalized XY changes the unchanged model from accepted HELLO (0.97993) to rejected IT (0.17819). Applying the measured inverse conversion to real browser output restores accepted HELLO (0.97847). This establishes a coordinate-domain cause for this clip without assuming that every remaining error has the same cause.

Before declaring a local model contract, all **745/745 saved-model ISL train/validation identities** were audited: 628 training and 117 validation clips, all 49 labels, zero match/parse failures. Every shape was (1080,1920); every visible body/hand component was pixel-like, with no mixed normalized entries. Saved model source metadata exactly matches the prepared manifest. Original pickle opcodes and numeric buffers were inspected without executing constructors. No final test arrays were read. Shape consistency alone does not independently prove axes for every clip; the paired-video evidence establishes the chosen convention.

The new `signbridge-gru-v2` artifact requires exact `cameraInput` metadata: format `signbridge-camera-coordinates-v1`, space `normalized-image` or `axis-scaled-image`, and bounded integer `scaleX`/`scaleY`. Identity requires scales 1/1. Missing or invalid v2 metadata fails closed. Old v1 artifacts retain their historical identity behavior and cannot silently carry new metadata. Old clients reject the new artifact version.

The camera wrapper checks capture quality on the original camera coordinates, then copies and converts XY exactly once before the unchanged GRU preprocessing. Z, confidences, timing, weights, thresholds and raw archive inference remain unchanged. Explicit model-space diagnostic input avoids a second conversion. No scale is inferred from language, a model hash or the laptop's aspect ratio.

`scripts/declare-camera-coordinates.mjs` creates a separate audited v2 artifact, refuses to overwrite an existing file, and verifies that learned content and thresholds are unchanged. The original local v1 file was backed up before activating the ISL v2 copy. The ASL artifact was not annotated or changed; its corpus needs an independent audit.

Artifact identities:

- Original ISL v1 SHA-256: `9bdba60b46b4d513a7de120cfb6f0f712a98daf0842528a527d13f28d43f719e`.
- Declared local ISL v2 SHA-256: `55c23fffe387944a102c804676ae91aa7276781d598b7adaf03f0115234acdd9`.

Paired baselines were recomputed with the new artifact's raw-archive predictor: HELLO and THANK YOU posterior values are unchanged. The realtime browser pass used the new hash, default normalized input and automatic model-declared conversion.

## Reproduce locally

1. Start the local site and open `/#training-studio`.
2. Expand Recognition diagnostics and choose a permitted complete sign video.
3. Optionally choose its `signbridge-recognition-baseline-v1` JSON. It must contain the same language, exact video/model hashes and offline result. A supplied label alone is not ground truth.
4. Run the realtime path, then the sequential path. Compare actual labels, accepted outputs, reasons and sample counts.
5. Explicitly download the redacted scalar report if needed.

The source videos, archive poses, manifests and measured JSON reports are retained locally in ignored research/log directories. They are not included in the public branch or deployment. The public demo still excludes research recognition weights and this diagnostic panel.

## Remaining work

Evaluate the corrected local camera model with held-out signers, nonsigning/unsupported signs and actual webcam turns before enabling automatic human translation. THANK YOU's remaining low score shows that coordinate compatibility does not solve all detector/signer differences. Future data preparation should retain explicit shape/axis metadata, canonicalize archive and webcam inputs consistently, and export the resulting contract. Mixed source shapes require canonicalization/retraining rather than copying this ISL scale to other models.

No fluent-signer webcam pass, physical two-device translation pass, continuous sentence translation, heard speaker output or complete reverse sign-video translation is claimed here. Existing room delivery and speech callback tests do not establish these missing results.

## Sources

- [Official INCLUDE dataset card and CC-BY-4.0 attribution](https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md); [original video record](https://zenodo.org/records/4010759).
- [Google MediaPipe Holistic configuration and JavaScript API](https://chuoling.github.io/mediapipe/solutions/holistic.html).

## Checks

The final `npm run check` passed: **314 Node tests, 423 UI tests and the regular production build**. `npm run build:public` passed afterward; the output contains no research weights, ONNX model files or source videos. Existing build size warnings remain. Automated fixtures verify contracts/lifecycle and are not counted as sign accuracy evidence.
