# SignBridge software upgrade — 2 October 2026

Sign Workspace now joins the existing local whole-word recognizer to reviewed message composition, contextual conversation and explicit training-data collection. This is implemented software, with a separate [four-week roadmap](software-roadmap-2026-10-02.md) for improving recognition with real signers. The existing learned weights and recognition thresholds are unchanged; no new signing accuracy is claimed.

## Use the workspace

Open `http://127.0.0.1:5173/#trained-sign`, or choose **Sign Workspace** on Home. ISL and ASL load separate models with 49 and 100 isolated words respectively.

1. Start the camera, choose a supported word and capture its complete sign with shoulders and signing hands visible. Finish manually, or let the 12-second limit finish the turn. Prediction happens after Finish.
2. Review the word. An uncertain result may offer three tentative suggestions; choosing one is a manual correction. Nothing is added to your message automatically. **None of these** keeps an unsupported turn from becoming a guessed word.
3. Use **Add word to message**, then capture the next word. Edit the message, undo the last addition/edit, clear it or speak it locally. The draft is limited to 2,000 characters. Word labels and local message speech are English.
4. **Send reviewed message** sends only the reviewed text and recent completed conversation history for an AI reply. Failed or interrupted requests keep the draft for retry. Reply language is selectable. Saved sign videos play where your local dictionary has coverage; missing words remain visible.

Capture diagnostics show hand/shoulder visibility, sample count, duration, sampling rate and the longest tracking gap. These describe camera tracking, not whether the person signed correctly. Space starts/finishes a capture outside form controls; Escape cancels capture or interrupts AI work. Pending AI/sample saves cannot start another capture. End stops the camera and speech, cancels pending AI and clears the draft/review. New conversation clears history. Changing either language resets the session and releases the camera.

*Archived test capture omitted from this public source snapshot.*

## Collect checked training examples

After Finish, expand **Save this turn for model training**. Enter the independently checked label, or mark the turn **Unknown / no sign**. Use a stable anonymous signer code across all of that person's sessions and export batches. The session code is automatic. Check the explicit consent checkbox after checking the label/type and save.

The browser stores body/hand landmarks, confidence values and strictly increasing frame timestamps, along with signer/session codes, creation time, checked label/type and the original model prediction. It stores no video or audio. A sequence has 4–100 frames, all within 12 seconds; known signs require sufficient visible hand and shoulder frames. Label, type or signer changes reset consent. Nothing is saved automatically, and saving does not retrain the model.

Open `/#training-studio` for counts, language filters, inventory, individual deletion and JSON export. Changing this inventory filter does not change the workspace language. Storage is local IndexedDB for the current browser/origin, capped at 250 samples and 32 MB. Exporting does not remove samples. Check backup files before deleting local records or clearing browser data. Export poses and participant codes only to destinations participants have agreed to use.

*Archived test capture omitted from this public source snapshot.*

## Prepare exports for a separate training run

`training/import_samples.py` combines exports, validates poses and metadata, rejects duplicate sample IDs and applies an explicit signer split across all batches, sessions and languages. Each export is capped at 250 samples/32 MB; the combined collection is capped at 10,000 samples/256 MB. Re-exporting the same inventory into multiple input files will produce duplicate IDs; use disjoint batches.

Create a split file such as:

```json
{
  "format": "signbridge-signer-splits-v1",
  "signers": {
    "participant-a": "train",
    "participant-b": "val",
    "participant-c": "test"
  }
}
```

This illustrates the format, not an adequate participant count. Assign actual people before model selection; keep test people out of both training and validation. Unknown samples belong to validation/test signers only; exports containing unknown samples assigned to training signers are rejected.

From the repository in PowerShell, with the existing training environment:

```powershell
& .\.training-venv\Scripts\python.exe training\import_samples.py `
  --dataset batch-1.json --dataset batch-2.json `
  --splits splits.json --output-dir .training-data\webcam-study-01
```

Use a new output directory; existing outputs are never overwritten. Raw combined poses and an inventory retain source-batch provenance. Per-language training arrays are produced only when at least two known labels have eligible examples in every split and eligible unknown samples exist for validation/test. Incomplete data produces an inventory explaining the blocking requirements. Background turns rejected before browser inference remain in the inventory but are excluded from model-level calibration arrays.

This command neither trains nor deploys. After sufficient collection, a separate training/evaluation run must compare a candidate with the unchanged baseline on the same frozen recordings, validate calibration and numerical parity, and document results before replacing app weights. See the [existing training procedure and measured limitations](model-training-2026-10-01.md).

## Verification completed

| Check | Observed result |
| --- | --- |
| `npm run check` | 113 Node tests, 94 React/media tests and production/PWA build passed |
| Training Python unittest discovery | 42 tests passed |
| Actual laptop camera | Integrated Camera (04f2:b7b9), playing at 640 × 480 |
| Observed whole-word capture | 12 seconds, 93 pose frames, 7.8 samples/second, longest gap 150 ms; hands visible in 3/93 frames and shoulders in 93/93 |
| Inadequately framed turn | Rejected with no reliable word match; no HELLO fallback or automatic message addition |
| Language lifecycle | ISL 49 / ASL 100 vocabularies loaded; language switch stopped the camera, whose dimensions returned to 0 × 0 |
| Sample privacy | Training Studio showed zero samples after the capture; no camera footage was uploaded or saved |
| Studio navigation | ASL-only inventory filter retained the ISL session; Capture returned to the ISL workspace |
| Browser state at workspace verification | Sign Workspace open, camera off, empty draft and explicit AI setup notice; no Vite error overlay |
| Later AI key setup | Server restarted with the local key; setup returned HTTP 200 with configured=true, and a harmless text request returned HTTP 200 with a real Gemini reply |
| Later Chrome conversation test | A typed test asked the AI to remember MANGO. Its reply acknowledged the word; the next message asked for the remembered word and received MANGO. Each successful send cleared the composer and appeared in history |
| Later Chrome camera lifecycle | Integrated Camera started at 640 × 480 with readyState 4 and tracking ready; End session returned the video to paused, 0 × 0 |

Automated tests exercise message composition/undo, uncertain suggestions, history/retry, stale-response cancellation, speech preferences, missing keys, capture timing, consent changes, duplicate saves, storage concurrency/caps, export boundaries, inventory actions and batch/split validation. Browser camera, speech and provider responses are simulated in automated UI tests; the actual camera checks above are separate evidence.

The key was absent during the initial browser verification. After local key setup, the development server was restarted and the actual `/api/chat` sign-text endpoint returned HTTP 200 with the reply “Hello, how can I help you today?” to a harmless typed greeting. The key value was not printed, and `.env.local` is ignored by Git. A subsequent test on the already-open Chrome workspace verified typed message submission, a real AI reply, composer clearing and follow-up context. It also verified camera start/readiness and End. These checks do not evaluate cloud sign-video interpretation or signing accuracy. Audible speech and recognition of valid signing by fluent unseen signers remain unverified. The real camera rejection demonstrates a tracking gate, not recognition accuracy. Full continuous sentences, facial grammar and generated fluent signed replies remain unfinished. Reply-video coverage depends on clips in the user's library; the tested replies correctly showed zero matching clips.

*Archived test capture omitted from this public source snapshot.*

The [one-month roadmap](software-roadmap-2026-10-02.md) prioritizes checked webcam data, separate ISL/ASL evaluation, calibration and verified phrase replies. Its metrics are proposed targets, not achieved results.
