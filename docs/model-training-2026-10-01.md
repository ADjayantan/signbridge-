# SignBridge model training and evaluation — 1 October 2026

Two isolated-word temporal classifiers were trained locally on real, public pose recordings: **49 ISL classes and 100 ASL classes**. These are experimental word-recognition models. The measured held-out top-1 results are **75.00% ISL** and **40.78% ASL** under the recording splits described below. Recognition accuracy on this laptop, unfamiliar signers and continuous sentences has not been measured.

## Sources, downloads and local research use

The data comes from the authors' [OpenHands labelled pose release](https://zenodo.org/records/6674324), linked by the [official dataset documentation](https://openhands.ai4bharat.org/en/latest/instructions/datasets.html). These are pre-extracted temporal body/hand landmarks, rather than generated gestures or downloaded demonstration photos. The original datasets are [INCLUDE](https://zenodo.org/records/4010759) and [WLASL](https://github.com/dxli94/WLASL).

| Archive | Download | Verified byte length | Verified MD5 |
| --- | --- | ---: | --- |
| INCLUDE.zip | [Official Zenodo content](https://zenodo.org/api/records/6674324/files/INCLUDE.zip/content) | 662,887,244 | `f99f6f3ea50d5d94e0ffae44130a6672` |
| WLASL.zip | [Official Zenodo content](https://zenodo.org/api/records/6674324/files/WLASL.zip/content) | 1,036,098,375 | `c45b690a5340da71d9a75db19e0cc572` |

Both completed downloads were checked against the sizes and checksums in the saved Zenodo record metadata before preparation. Full-file downloads stalled in this environment; bounded 16 MB HTTP ranges completed, with each `Content-Range` checked and the whole-file MD5 verified afterward. Archives remain in `.training-data/archives`.

The pose record and original INCLUDE record carry **CC BY 4.0** metadata. WLASL's authors also require the [Computational Use of Data Agreement](https://github.com/dxli94/WLASL/blob/master/start_kit/C-UDA-1.0.pdf) and state academic/computational use only, with no commercial use. This work uses the data and model artifacts locally for experimental research; it does not redistribute or publish them. The pose record's license metadata is not treated as permission to disregard the original WLASL conditions. Original record JSON, source metadata, the WLASL agreement and README are retained under `.training-data`.

The official [OpenHands source](https://github.com/AI4Bharat/OpenHands) provides the extraction schema and split metadata. INCLUDE stores a nested `Pose_Signs.zip`; preparation copies only that exact, size-bounded member to a fixed cache file, then reads selected entries directly. It never broadly extracts archive paths. Pickles from the checksum-verified sources use a restricted NumPy constructor allowlist, numeric shape checks, finite-value checks and byte limits. Arbitrary Python globals and object arrays are rejected.

## Split policy and exclusions

| Language / selected vocabulary | Training | Validation | Known test | Unknown validation | Unknown test |
| --- | ---: | ---: | ---: | ---: | ---: |
| ISL, 49 selected INCLUDE50 classes | 628 | 117 | 192 | 100 | 200 |
| ASL, first 100 official WLASL classes | 1,435 | 335 | 255 | 100 | 200 |

**ISL:** all 766 original INCLUDE50 training poses and all 192 original test poses loaded. Validation takes a seeded, class-stratified 15% of the training recordings, with seed 42. The original `97. dry` class has no recording in the official INCLUDE50 test CSV. It was therefore excluded, removing its 21 training and 3 validation recordings. The resulting evaluation is a **49-class selected subset**, not an unchanged INCLUDE50 benchmark. One missing pose was encountered while selecting unknown-vocabulary validation recordings: `Days_and_Time/Second (Number)/MVI_5506.MOV`; another available recording filled that sample budget.

**ASL:** original WLASL100 metadata contains 1,442 training, 338 validation and 258 test instances. Thirteen known recordings had fewer than four hand-visible frames: 7 training, 3 validation and 3 test. Their exclusion leaves the counts above; all 100 classes remain represented in every known split.

Every prepared clip ID is unique within its split and disjoint across all five splits. Unknown samples come only from unselected vocabulary: separate original full-INCLUDE training/test pools for ISL and original WLASL validation/test pools outside its first 100 classes for ASL. Unknown recordings never enter known-class training. The prepared arrays retain IDs, source glosses, available signer IDs, class counts and every skipped-file reason.

Normalization, checkpoint selection and rejection calibration use training/validation data only. Test **class availability** was inspected to exclude incomplete classes; test feature values and predictions were not used to choose normalization statistics, the checkpoint or rejection thresholds. This distinction matters when reading the preparation metadata's `test_used_for_selection:false` field.

These are recording-level splits. The available ISL split CSVs have no signer identity fields. For the prepared ASL split, **52 of 56 test signer IDs also occur among the 91 training signer IDs**. Neither result supports an unseen-signer accuracy claim.

## Model and feature contract

Training used Python 3.12, NumPy 2.5.3 and **PyTorch 2.14.1+cpu**, with four CPU threads and deterministic seed 42. The available RTX GPU was not used for these small runs. Each model is one GRU layer with input width 81 and hidden width 64, followed by dropout 0.15 and a linear class head. AdamW uses learning rate 0.002 and weight decay 0.0001; minibatches contain 64 recordings and gradient norm is limited to 5. Checkpoint selection maximizes validation macro recall. The actual ceiling was 180 epochs; after epoch 40, 35 stale epochs stop training.

| Model | Epochs run | Selected epoch | Recorded training time |
| --- | ---: | ---: | ---: |
| ISL | 126 | 91 | 12.77 seconds |
| ASL | 172 | 137 | 40.25 seconds |

These times cover the trainer run, not downloads, dependency installation or data preparation.

The shared `signbridge-pose27-xyc-v1` contract reads 75 landmarks in order: body 33, left hand 21, right hand 21. It selects 27 landmarks:

```text
0, 2, 5, 11, 12, 13, 14, 33, 37, 38, 41, 42, 45, 46,
49, 50, 53, 54, 58, 59, 62, 63, 66, 67, 70, 71, 74
```

Leading/trailing frames without a hand wrist score of at least 0.5 are trimmed. A sample needs four hand-visible frames and four frames with both shoulder scores at least 0.2 inside that interval. Coordinates are centered on the shoulder midpoint and divided by shoulder width, clamped to at least 0.05. Joint scores below 0.2 become zeros, and invalid-shoulder frames become zeros. Valid x/y coordinates are clipped to [-5, 5], confidence to [0, 1]. Linear resampling produces **32 × 81** values: 27 joints × x/y/confidence. There is no mirroring augmentation and no facial-expression input. Feature means and standard deviations are learned only from training recordings, with standard deviation floored at 0.05.

The exported models are numeric JSON weights and metadata at `public/models/isl.json` and `public/models/asl.json`. They are ignored by Git, alongside `.training-data`, the Python environment and training artifacts; they currently exist only in this local checkout.

## Held-out evaluation and uncertainty

Top-1 below asks whether the highest-probability known-class prediction is correct, before rejection. Accepted/rejected counts apply the calibrated confidence and top-two probability-gap thresholds.

| Held-out metric | ISL | ASL |
| --- | ---: | ---: |
| Known test recordings | 192 | 255 |
| Top-1 correct | 144 / 192 | 104 / 255 |
| Top-1 accuracy | 75.00% | 40.78% |
| Top-5 accuracy | 93.23% | 69.41% |
| Accepted and correct | 90 | 22 |
| Accepted and wrong | 3 | 5 |
| Rejected known recordings | 99 | 228 |
| Confidence threshold | 0.95 | 0.98 |
| Minimum top-two probability gap | 0.30 | 0.30 |
| Unknown test false accepts | 27 / 200 | 9 / 200 |
| Unknown test false-accept rate | **13.50%** | **4.50%** |

Calibration searches only known and unknown validation recordings, penalizing accepted mistakes and requiring at most 10% unknown validation false accepts. ISL validation met that limit at 10/100; ASL at 3/100. **The ISL unknown test result exceeds that validation target.** Confidence is therefore not a guarantee that an unfamiliar sign will be rejected. ASL also rejects most known test recordings at the chosen thresholds. These are experimental baselines, with substantial coverage and error limits.

The raw model scores do not measure spontaneous laptop signing, unseen signers, fingerspelled sequences or fluent sentence translation. A closed vocabulary model can confidently map an unfamiliar sign to a known word. The app must retain tentative review and correction rather than presenting that output as a validated translation.

## Numerical parity and application checks

The standalone browser parity check compares three genuinely held-out, prepared examples against PyTorch probabilities, then one real held-out raw pose per language against Python feature preprocessing. Maximum absolute errors were:

| Parity check | ISL | ASL |
| --- | ---: | ---: |
| Model probabilities | `8.3768e-7` | `3.5534e-7` |
| Raw-pose preprocessing | `7.2094e-7` | `1.8286e-7` |
| Result | PASS | PASS |

This establishes numerical agreement on the checked examples, not signing recognition accuracy. The regression checks passed: **95 Node tests + 70 UI tests + 25 Python tests = 190 automated checks**. Production build and PWA generation passed. Mocked browser/media tests establish lifecycle and interaction behavior; the held-out metrics above come from actual dataset poses.

A subsequent SDK integration fix preserves detected hands: Tasks Vision supplies `visibility:0` when hand visibility is absent, so complete finite hand arrays now receive confidence 1, matching OpenHands' extraction contract. Body visibility is retained; absent, partial or invalid hand arrays remain missing. Two regressions cover this behavior and both real-artifact numerical parity checks still pass. The held-out model metrics are unchanged. See [the cancellation and camera integration fix](aborted-error-2026-10-01.md).

The final browser check confirmed both local artifacts loaded: **49 ISL words and 100 ASL words**. The Integrated Camera `(04f2:b7b9)` played a 640 × 480 stream at readyState 4, and Holistic became ready with body landmarks and zero detected hands. Capturing that nonsigning turn and manually finishing returned **“No clear signing found”**, left the meaning empty and kept Speak disabled, with no HELLO fallback. Starting and cancelling another turn returned to ready with no result. End session reset the video to readyState 0, 0 × 0 dimensions and paused playback. Changing language reset the session and loaded the matching vocabulary and evaluation result. No footage was uploaded or saved and automatic speech was off. The final page has ISL selected with the camera off. This negative case is not a successful live-word recognition trial.

*Archived test capture omitted from this public source snapshot.*

## Reproduction

Run from `C:\Users\adjay\Downloads\signbridge`. The checked local `.training-venv` already contains the versions above; `training/requirements.txt` lists the required Python packages. Preparation additionally requires the two checksum-matching archives under `.training-data/archives` and the original split files under `.training-data/metadata`.

On a fresh checkout with Python 3.12 installed, create the environment and install the CPU runtime from the official PyTorch index:

```powershell
py -3.12 -m venv .training-venv
& .\.training-venv\Scripts\python.exe -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
& .\.training-venv\Scripts\python.exe -m pip install numpy==2.5.3
```

The INCLUDE metadata filenames are `train_include.csv`, `test_include.csv`, `train_include50.csv` and `test_include50.csv` from the official [OpenHands INCLUDE split directory](https://github.com/AI4Bharat/OpenHands/tree/main/openhands/datasets/assets/include_metadata/Train_Test_Split). ASL uses `WLASL_v0.3.json` from the official [OpenHands WLASL split directory](https://github.com/AI4Bharat/OpenHands/tree/main/openhands/datasets/assets/wlasl_metadata/splits). Source archives, split metadata and license files must be supplied on a fresh checkout; Git does not contain the data or weights.

```powershell
& .\.training-venv\Scripts\python.exe training\prepare_data.py --language both
& .\.training-venv\Scripts\python.exe training\train_model.py --language isl --epochs 180 --hidden 64 --seed 42
& .\.training-venv\Scripts\python.exe training\train_model.py --language asl --epochs 180 --hidden 64 --seed 42
node training/check-browser-parity.mjs
& .\.training-venv\Scripts\python.exe -m unittest discover -s training -p "test_*.py"
npm run check
```

Preparation writes `.training-data/prepared/{isl,asl}.npz`, corresponding `.metadata.json` reports and real held-out `-raw-parity.json` fixtures. Training writes `public/models/{isl,asl}.json` and `training/artifacts/{isl,asl}-metrics.json` / `-parity.json`. The trainer also accepts `--data` and `--output` paths. The parity script accepts optional positional languages, for example `node training/check-browser-parity.mjs isl`.

Full metrics, labels, exclusions and provenance remain in the local JSON reports. Reproducing training under another NumPy/PyTorch version, machine or dataset revision can change numerical results; the source hashes and metadata identify this run.
