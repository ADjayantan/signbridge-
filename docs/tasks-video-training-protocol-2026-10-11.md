# Current-detector ISL training protocol — 11 October 2026

This second local study responds to another failed user webcam attempt after the camera-aligned archive experiment. That rejected attempt had 45 pose samples, 39 hand-visible samples and a weak ELECTION score around 0.262. It is diagnostic evidence only: no private footage or pose sample is retained or used for training. This protocol is written before new video predictions, extraction or fitting.

## Sources and selection

Use official [INCLUDE videos](https://zenodo.org/records/4010759), attributed to Sridhar, Ganesan, Kumar and Khapra (2020), under the CC BY 4.0 terms in the [official dataset card](https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md). Original archived poses remain from the checksum-verified [OpenHands release](https://zenodo.org/records/6674324).

Freeze the exact video IDs, source words, split assignment, ZIP member sizes/CRC and official archive metadata in a selection plan before downloading video bytes or obtaining predictions. A later final manifest binds that plan hash to verified member SHA-256 values. The newer full INCLUDE CSV and the existing subset CSV are not interchangeable: known examples keep the existing 49-word prepared split membership. Full CSV rows may supply additional unsupported words only after every existing partition ID is excluded.

Target at most eight training examples each of HELLO, THANK YOU and GOOD MORNING, four FATHER training examples, and at most two existing validation and two existing test examples per selected known word. Exclude the four previous camera-study raw replay files, HELLO MVI_9917 and THANK YOU MVI_0008 from this new raw-video selection. Their archived training features are not removed from the legacy training partition. Available source membership may yield fewer than the maximum; count the shortfall explicitly in the frozen plan. Preserve all 49 model outputs and confusable words.

For fresh Tasks unsupported examples, deterministically sort the six unsupported Greetings source words. Use the first three for training (up to four unused official-train recordings per word), the fourth for validation (up to six unused official-train recordings), and the last two for test (up to three unused official-test recordings each). No source word or recording may cross these three new unsupported groups. Reject an infeasible selection before fitting; never borrow evaluated holdouts to fill a quota.

Hard acquisition bounds: at most 100 clips, 45 MiB per member, at most 900 MiB compressed selected payload, 900 MiB uncompressed selected payload and 1 GiB actual network reads including retries and metadata. Preserve resumable files only after checksum verification. No complete multi-GB video archive download. The raw-video ZIP's whole-file MD5 is not established by partial ranges; report this separately from CRC/member SHA verification.

## Actual detector extraction

Use the app's current Tasks Holistic CPU VIDEO loader, model bundle and pose adapter. [MediaPipe's official guide](https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker) describes its normalized body/hand landmark outputs. Extract decoded source frames at 0, 125, 250 ... milliseconds, strictly below each video duration, using a 1280×720 black contain canvas matching the user's verified current camera dimensions. This is sequential source-time sampling, not measured real-time speed or an actual webcam recording. A different subject/framing remains a domain difference.

Every saved frame contains 75 joints in body33/left21/right21 order, each [normalized x, normalized y, confidence], plus source atMs. Confidence is not z. No synthetic tails, duplicate final holds, mirroring, reversal or expected-word input is allowed. Use a fresh tracker per clip, maximum 100 measured frames and 12 seconds per clip; release all media/tracker/object URLs. Extraction uses explicitly selected public files, with no camera or microphone access.

The JSON contract is signbridge-tasks-video-poses-v1. It binds raw manifest and extractor-module SHA-256, exact config, partitionGroup learning/test, selected clip identities and one explicit result per selected clip. Keep rejected/error/cancelled rows. Do not silently omit failures from denominators. Fit reads only a learning export; test frames are extracted and supplied to a separate evaluation after candidate freezing. Each group has a 30-minute extraction cap; incomplete extraction is not a completed study.

## Fixed fitting choices

Warm-start the previous frozen camera candidate, SHA-256 a77f33b3f0d2ca7570b041e4cf93fa1ee3374efc6e974cb975ae80f587041004. Preserve its normalization, 49-label order and browser-compatible GRU27 architecture. This is targeted fine-tuning of a previously evaluated research model, not training from a clean blind baseline.

Known training rows are the 628 original canonical archived training clips, plus each quality-eligible newly extracted known training recording given weight four through sampling entries. Weighting does not create additional independent recordings or fabricated frames. No legacy validation, test or unknown holdout is used for gradients.

Unknown training includes eligible new Tasks unknown_train rows and at most 200 additional unused archived official-train clips. Select archive negatives deterministically in word-balanced round-robin order, excluding all legacy partition identities, all new manifest identities, every source word represented in previous unknown holdouts and the new Tasks unknown validation/test source words. Pin this pool before fitting. The resulting pool can be smaller if verified members are unavailable; report the actual count. These are intentional unsupported signs, not idle-camera negatives.

For each optimizer step use mean known-label cross-entropy plus 0.25 times uniform-target cross-entropy on unknown logits: -mean over examples of mean over 49 labels of log_softmax(logits). This training-only outlier exposure leaves 49 runtime outputs and the existing acceptance policy intact. AdamW learning rate 0.0005, weight decay 0.0001, known batch size 64, negative batch size at most 16, gradient norm limit 5, existing dropout, seed 42, four CPU threads, maximum 120 epochs/600 seconds. Early stop after 20 stale epochs after epoch 20.

Select checkpoint using new Tasks validation known macro recall minus new Tasks unknown fixed-gate false-acceptance rate, with exact ties broken by lower known validation cross-entropy. New Tasks validation is development data and may influence checkpoint selection; it never supplies training gradients. No repeated hyperparameter search or benchmark-guided threshold calibration is authorized by this protocol.

## Evaluation and decision

Keep score acceptance 0.95 and margin 0.30. Freeze candidate hash, source/configuration hashes and learning identities before test extraction/evaluation. Evaluate selected new Tasks test clips once, plus the previously examined archived validation/test/unknown benchmarks for regression. Distinguish these correlated/reused sources from an untouched test of new people. All known/unknown source counts include extraction rejections; report inference-eligible counts separately.

Minimum local research screens on new Tasks validation and test: accepted known precision at least 95%, correct known coverage at least 60%, unsupported-word false acceptance at most 5%, and at least one correctly accepted HELLO test recording with no accepted wrong HELLO test label. The original complete archived benchmark must retain at least 95% accepted known precision, 60% correct known coverage and at most 5% unsupported false acceptance, with no regression against the active baseline's primary measures. Report candidate versus warm-start and active baseline on identical available test inputs. Confirm Python/browser numerical parity on actual learning fixtures before any local installation.

If these gates pass, a clearly labelled experimental local model may replace the laptop model with a recoverable byte-for-byte backup. A public deployment is outside this study. If a gate fails, retain the active model and report the measured failure. No threshold reduction, forced label or speech of rejected guesses is allowed. Even passing these small dataset screens does not establish reliability on this user, unseen signers, ordinary motion, continuous sentences, facial grammar or regional variants. Separate consented live webcam trials and real idle/incomplete-motion negatives remain necessary.

Keep the study, raw video/poses/weights and backups inside ignored local research directories. Store scalar evidence and the decision in a new report. Do not change the previous frozen study or its protocol.

## Pre-extraction availability amendment — 13 October 2026

Before any new video download, prediction, extraction or fitting, the official ZIP index preflight rejected the initial 66-recording selection: compressed payload 994,883,655 bytes and decompressed payload 1,015,360,716 bytes both exceed the fixed 900 MiB limits. No model result was consulted and no plan was frozen.

Reduce only the maximum new training count for HELLO, THANK YOU and GOOD MORNING from eight to six each, using the same lexicographic identity ordering and exclusions. Keep four FATHER training recordings and all selected validation, test and unsupported-word groups. The revised target is 60 recordings: train 22, validation 6, test 8, unknown_train 12, unknown_val 6 and unknown_test 6. Preflight the revised exact payloads before freezing; all byte limits, partition rules, fitting choices and evaluation gates above remain fixed. A revised target is not evidence of completed downloading or training.

Before extraction or fitting, observed serial acquisition took approximately 64 seconds between the first two verified clips. An additional bounded parallel acquisition wrapper may fetch the identical frozen members with at most four workers. Preserve the original selection plan and downloader byte-for-byte; record the wrapper/base/plan hashes in a separate acquisition receipt. Global network accounting must be thread-safe and survive interruption, using conservative persisted reservations where an exact interrupted read count cannot be recovered. Keep the same 1 GiB cumulative payload-read cap and checksum/resume rules. This is an acquisition implementation amendment, not a change to recordings, labels, partitions, model parameters or evaluation criteria.
