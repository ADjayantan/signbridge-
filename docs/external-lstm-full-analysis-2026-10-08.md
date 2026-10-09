# Full external LSTM repository assessment — 8 October 2026

The repository contains a real, reusable small-vocabulary landmark collection, training and inference prototype. Its strongest contribution to SignBridge is a reference for learning motion from ordered joint coordinates. It does **not** contain a verified broad sign-language translator, and copying its model files would not solve SignBridge's recognition or reverse sign-output gaps.

Repository: [Realtime-Sign-Language-Detection-Using-LSTM-Model](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model). This review pins all source observations to [commit 1b2c3169459f00acea2fe3a3046aeaaa875497b2](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/commit/1b2c3169459f00acea2fe3a3046aeaaa875497b2), dated 18 November 2025, which was the current main head when inspected.

## Scope and evidence

The complete recursive GitHub tree was inspected and was not truncated. Both notebooks' source cells, relevant saved outputs, both READMEs, every v2 source/dependency file, the license and funding metadata were reviewed. Artifact filenames, Git metadata and sizes were inspected; the H5 binaries were **not downloaded or deserialized**. No external code, notebook cell, camera capture, dependency install, training or inference was run. Notebook outputs are the author's saved observations, not reproduced results. Findings about runtime failures are code-level inferences unless explicitly stated otherwise.

Primary tree evidence: [GitHub tree API at the pinned commit](https://api.github.com/repos/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/git/trees/1b2c3169459f00acea2fe3a3046aeaaa875497b2?recursive=1).

## What is actually included

| File | Actual purpose |
| --- | --- |
| [RealTimeSignLanguageDetection.ipynb](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/RealTimeSignLanguageDetection.ipynb) | End-to-end educational notebook: webcam landmarks, local sample collection, LSTM training, small holdout evaluation, model saving and rolling webcam predictions. |
| [Train.ipynb](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/Train.ipynb) | Separate training script inside a notebook, expecting pre-existing local landmark arrays. |
| [model.h5](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/model.h5), [model_weights.h5](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/model_weights.h5) | Bundled binary model and weights, respectively 7,228,888 and 2,414,536 bytes. Both were last changed in the 17 May 2023 project-files commit. A separate ordered label manifest is absent. |
| [v2/main.py](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py) | Console program with configurable labels, collection, training, webcam inference and video-file inference. |
| [v2/README.md](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/README.md), [v2/requirements.txt](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/requirements.txt) | Usage instructions and pinned Python dependencies. The dependency set has a confirmed constraint conflict, detailed below. |
| [README.md](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/README.md), [LICENSE](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/LICENSE), [.github/FUNDING.yml](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/.github/FUNDING.yml) | Project description/demo references, MIT license and sponsorship settings. Funding metadata contains no application code. |

The tree has no training dataset, signer/session records, verified sign dictionary, saved label/config manifest, automated tests, browser frontend, room server, speech recognizer or sign-reply video library. README accuracy and language-flexibility claims exceed the evidence supplied by the code and tiny saved evaluation.

## How recognition works

Both implementations first run MediaPipe Holistic on camera images, then train on extracted numeric landmarks. Each frame is flattened in this fixed order:

- 33 body points with x, y, z and visibility: 132 values.
- 468 face points with x, y and z: 1,404 values.
- 21 left-hand and 21 right-hand points with x, y and z: 126 values.

Total: **1,662 values per frame**. Missing landmark groups become zero-filled blocks. Thirty frames form the default sequence. The model is LSTM 64 → LSTM 128 → LSTM 64 → Dense 64 → Dense 32 → class softmax; the saved original notebook summary has three outputs and 596,675 parameters. v2 uses the same architecture with configurable sequence length and class count. [Extractor](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py#L104-L125), [model construction](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py#L214-L236).

This supports the user's idea of training on joint coordinates rather than raw image pixels. Camera frames are still needed to extract those coordinates. It does **not** eliminate the need for correctly labelled examples across signers, timing, lighting and camera positions.

The drawn connecting lines are a visual overlay. The model flattens points and learns a temporal sequence; it does not use graph adjacency or graph convolutions. It is an LSTM coordinate model, **not a graph neural network**. No application-level centering, shoulder-scale normalization, timestamp/FPS resampling, explicit missing-point mask or augmentation is implemented. Capturing 30 frames is not a fixed duration across devices.

## Original notebooks: vocabulary and evaluation are inconsistent

`Train.ipynb` trains on HELLO, THANKS and ILOVEYOU. The larger notebook's collection/training cells use CAT, FOOD and HELP; its saved label map and FOOD prediction outputs reflect that list. Its final inference cell switches the displayed names to HELLO, THANKS and ILOVEYOU while loading the same filenames.

Therefore these are **two conflicting three-label examples**, not six verified signs. Without the dataset or an artifact label manifest, the bundled H5 mapping cannot be established from source names alone. BOOK and DRINK are not in either original list. v2 permits custom names, but entering a name does not make a pretrained model understand that sign.

The larger notebook saves a 1.0 accuracy output and confusion matrices totalling only **five holdout examples**. It uses a random 5% split, with no signer grouping or independent live evaluation. The separate training notebook's saved final training metric is approximately 36.5%; the larger notebook's final training metric is 100%. These are different recorded runs, not evidence of stable generalization or measured deployment performance. [Both label choices, training and saved evaluation](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/RealTimeSignLanguageDetection.ipynb), [separate training run](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/Train.ipynb).

The original live loop accumulates changing labels into a maximum five-word list. Its recent-prediction condition checks the first sorted unique value against the current winner; mixed predictions can satisfy that condition. It does not require all ten recent predictions to agree. Consecutive identical words are suppressed without gesture boundaries. This is a label-history display, not grammatical sentence translation. The apparent audio conversion lines are commented and no speech-output implementation is supplied.

## v2: useful expansion, with important gaps

v2 separates configuration, MediaPipe processing, data handling, model handling and inference. Its four console modes support collecting custom-labelled landmarks, training, webcam inference and local video-file inference. The default collection creates 30 sequences of 30 frames per entered label in `MP_Data/<sign>/<sequence>/<frame>.npy`. Live inference repeatedly classifies the latest sequence and displays per-class probability bars. [Entry flow](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py#L319-L363).

| Finding | Practical consequence |
| --- | --- |
| Model saving omits ordered labels and frame configuration; inference asks for them again. | Reordering the same number of labels silently renames predictions. Different window lengths or label counts can fail compatibility. Save/load must use one versioned manifest. [Save/load](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py#L238-L244). |
| v2 has no acceptance threshold, temporal stabilization, idle/unknown handling or gesture boundaries. | A rolling probability winner is not a trustworthy message. Unsupported movement and missing landmarks still enter classification. [Inference](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py#L270-L301). |
| A failed camera read advances the numbered frame without saving it; the loader assumes complete files. The first frame is acquired before the initial wait. | Partial samples can fail loading and sample timing is uneven. Recollection reuses filenames, potentially overwriting examples. Use complete-sequence validation, explicit cancellation and unique sample IDs. [Collection/loader](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py#L140-L202). |
| Default training uses 2,000 epochs and a random unstratified 5% holdout without validation, early stopping, seeds or signer/session grouping. | This cannot show performance for an unfamiliar signer. There is no false-acceptance, per-word coverage or latency report. [Training](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/main.py#L214-L236). |
| Video inference ignores original frame timing and exports no result transcript. | It is a visual diagnostic tool, not a reusable labelled dataset or conversation service. |

### Installation blocker verified without installing

The requirements pin TensorFlow and TensorFlow Intel 2.15.1, JAX 0.5.3 and ml-dtypes 0.5.4. Official package metadata says TensorFlow needs ml-dtypes approximately 0.3.1, while JAX needs at least 0.4.0. No single version satisfies both. The pinned 0.5.4 also directly violates TensorFlow's range. [Requirements](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/v2/requirements.txt), [TensorFlow metadata](https://pypi.org/pypi/tensorflow/2.15.1/json), [TensorFlow Intel metadata](https://pypi.org/pypi/tensorflow-intel/2.15.1/json), [JAX metadata](https://pypi.org/pypi/jax/0.5.3/json).

It also pins both OpenCV Python distributions that provide the same `cv2` namespace; official packaging guidance says to select one. A clean, minimal environment must be established before any experiment. [OpenCV packaging guidance](https://pypi.org/project/opencv-python/4.11.0.86/).

## Ranked application to SignBridge

| Priority | What we can build or reuse | Required work and honest limit |
| --- | --- | --- |
| **1: research baseline** | Add an **LSTM75 control** beside SignBridge's GRU75 and ST-GCN experiments. | Train a new model on the same existing 32×75×3 feature contract, vocabulary, signer splits, budgets and acceptance gates. Compare accepted-correct coverage, precision and unknown false acceptance; freeze decisions before final evaluation. LSTM is a candidate, not an assumed upgrade. |
| **2: motion diagnostics** | Use rolling-window/probability visualizations to understand moving-sign failures. | Keep them in the training/debugging tool. Show tracking quality and rejected/uncertain states; probabilities are not proof of linguistic correctness. Much of the camera/joint overlay already exists locally. |
| **3: reviewed vocabulary expansion** | Adapt the collection workflow for a small set of verified signs or phrases. | SignBridge already collects and exports consented joint samples. Add coverage/integrity checks and fluent review rather than duplicating the console collector. New names require real labelled examples and separate ISL/ASL review. |
| **4: offline video inspection** | A development-only batch diagnostic for consented, appropriately licensed clips. | Record timing and quality; export structured predictions for reviewer comparison. Upstream video mode currently offers visual inference only. Do not treat predicted labels as training ground truth. |
| **5: deployment-ready artifact packaging** | A manifest-bound experimental model registry and browser export. | Labels, shape, normalization, pose contract, version, evaluation and acceptance policy must travel together. Export a newly validated model to ONNX or another supported runtime; prove Python/browser parity and device performance before promotion. Upstream does not provide this package. |

### Why direct H5 replacement cannot work

SignBridge's current raw capture has 75 body/hand points and separate confidence values; it has no 468-point face mesh. Its graph model consumes **32×75×3 shoulder-normalized x/y/confidence**. The legacy model uses **32×81** features and a different artifact format. The external visible architecture consumes **30×1662 body/face/hand coordinates**. See local [pose contract](../training/graph-contract-v1.json), [preprocessing](../training/pose_graph.py) and [model definitions](../training/graph_models.py).

Existing samples cannot reconstruct the missing face input. Padding zeros, renaming weights or changing the frame count would not make the models equivalent. Adding a full Holistic branch would require new capture, data, consent/retention decisions, preprocessing, retraining and runtime measurements. Facial/depth features are a research hypothesis, not a guaranteed fix for BOOK or DRINK.

The upstream desktop webcam code also cannot simply run on Render to read a phone's camera: its camera request targets the server's local device. SignBridge should keep its browser camera and shared media lifecycle. HTTPS deployment solves access from another device; it does not retrain recognition or improve its accuracy automatically.

## What still needs a separate implementation

The user's complete goal is **sign → reviewed meaning → partner text/voice**, and **partner speech/text → accessible sign reply**. The repository helps investigate only the first recognition stage. It does not supply room transport, speech transcription, reviewed messaging, text-to-speech, verified sign videos, sign-language grammar generation, AI dialogue or continuous turn interpretation.

SignBridge already contains room/message transport and reviewed input/output paths. Reverse sign output needs verified, language-specific phrase videos or another separately evaluated generation approach. A generated label list is not a sign reply. A person who does not know sign language can test connection and controls, but cannot establish sign meaning correctness by copying unverified gestures.

## Recommended experiment and release gates

1. Keep the public conversation pilot and recognition research separate; preserve private recordings/artifacts and clearly show model availability.
2. Define a small verified vocabulary for one sign language first. Use fluent review or verified licensed examples; include non-signing and unsupported-sign negatives.
3. Train the LSTM75 comparison on the existing versioned contract and fixed signer-separated splits. Do not switch to the external feature representation merely to load its weights.
4. Evaluate word-level confusion, accepted-correct coverage, unknown false acceptance and stability. Retain review before sending; never auto-send uncertain predictions.
5. Export only a passing candidate, bind its manifest, verify browser parity, then measure camera latency and performance on the target laptop/phone.
6. Validate both communication directions with real participants and verified reply clips. Report limitations and failed words explicitly.

SignBridge's [existing twelve-word pilot](recognition-pilot-2026-10-05/README.md) failed its fixed validation gates. This review does not claim either implementation is already reliable or that a new LSTM will pass. No numerical upstream performance was independently reproduced.

## License and reuse

The upstream MIT license permits code reuse subject to retaining the copyright and permission notice in copies or substantial portions. Preserve the notice naming Avhishek Adhikary and record the pinned upstream commit if source is copied. This review copied no upstream source into the application. The code license does not establish consent, linguistic correctness or usage rights for recordings that are not supplied in this tree. [License](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/1b2c3169459f00acea2fe3a3046aeaaa875497b2/LICENSE).
