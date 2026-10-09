# External temporal-landmark prototype — 5 October 2026

Repository: [Realtime-Sign-Language-Detection-Using-LSTM-Model](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model).

This assessment inspected the repository tree, notebooks and Python source read-only. No notebook, Python program or downloaded model was executed. No dependency or external artifact was added to SignBridge.

## What the implementation demonstrates

The [training notebook](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/main/Train.ipynb) extracts body, face and hand coordinates, flattens them into 1,662 values per frame and feeds thirty ordered frames into stacked LSTMs. Its label list is `hello`, `thanks`, `iloveyou`. It reads previously collected local landmark arrays rather than requiring raw images as training inputs.

This is a temporal coordinate model, not a graph neural network: the visible model does not use a joint adjacency matrix or graph convolution. It supports the usefulness of landmark sequences as an input representation, but does not establish complete language understanding, accuracy on unfamiliar signers or natural sentence translation.

The [realtime notebook](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/main/RealTimeSignLanguageDetection.ipynb) predicts from rolling thirty-frame camera windows. A later cell uses the three labels above; earlier cells use another label list. The exact bundled weights-to-label mapping was not established. Accumulating different predicted labels in a list does not demonstrate grammatical sentence translation.

The [v2 program](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/main/v2/main.py) lets a user choose custom labels, collect examples, train and view live probabilities. Its [README](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/main/v2/README.md) describes defaults of thirty clips per label and thirty frames per clip. It does not supply an evaluated broad vocabulary or measured live latency.

## Source limitations

- The training code uses a random 5% holdout. No signer-group separation, independent live trial or unknown-sign evaluation is evident in the reviewed paths. A random clip split is insufficient evidence of accuracy on a new signer.
- The original realtime stability condition compares the current winner with the first value in a sorted set of recent predictions. This does not require every recent prediction to agree; the resulting stability weakness is an inference from that condition.
- v2 displays every rolling prediction without explicit confidence rejection, unknown/idle handling, stabilization or turn segmentation. Unsupported movement can still receive a known label.
- v2 saves model/weights without the label order. Each launch asks for label names again, and displayed probabilities use the new list. Changing label order can therefore silently rename predictions; changing label count or sequence settings can also invalidate compatibility.
- A failed camera read during collection skips a numbered sample. The loader later assumes all numbered files exist, so an incomplete collection can fail during loading.

These are code findings, not reproduced runtime failures. No numerical performance claim is made for the external model.

## Application to SignBridge

The rolling-window presentation and temporal-landmark learning concept are useful references. Direct replacement is incompatible: the external input is thirty frames of 1,662 raw body/face/hand values, while SignBridge's research input is thirty-two frames of seventy-five body/hand joints with normalized coordinates and confidence; the legacy input is also different. The external H5 files cannot simply be substituted for current artifacts.

BOOK is absent from the original training vocabulary. v2 could only learn it after appropriately labelled recordings and a new training run. Installing this repository does not fix the user's failed BOOK or DRINK trials. Switching GRU to LSTM alone is not evidence of an improvement.

Any future experiment should keep a fixed vocabulary manifest, versioned pose/label contracts, measured capture timing, missing/unknown rejection, signer-independent evaluation and reviewed meaning before delivery. SignBridge's own [twelve-word pilot](recognition-pilot-2026-10-05/README.md) failed its fixed gates, so this review is not a claim that SignBridge recognition is already better.

The repository carries an [MIT license](https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model/blob/main/LICENSE); future source reuse should retain its copyright/license notice. No external source has been copied into the application in this update.
