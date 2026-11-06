# SignBridge — detailed conversation and decision history for Argon

Prepared 26 October 2026, Asia/Calcutta. Read with `ARGON_MASTER_PROMPT_2026-10-26.md` and `ARGON_VERIFIED_STATE_2026-10-26.json` in this directory.

This is a detailed reconstruction of the conversation supplied to this chat and the project's saved reports. It preserves requests, corrections, frustrations, decisions and unfinished work. It is **not a word-for-word full chat export**, and it does not imply that every older assistant statement was verified. Exact technical current state is in the master prompt; source files take precedence over stale explanations.

## A. How the project goal developed

### 1. Bring an existing laptop project into this conversation

The user first shared `https://claude.ai/share/fc8dec45-6175-4603-895d-b0a3e635579c`, asked to assess the file, and said the project was already on the laptop and could be continued here. The current handoff has not retrieved that shared conversation's complete contents.

The main desired features were sign-to-speech, sign replies, strong video recognition, laptop camera access and an advanced implementation. The user wanted both ISL and ASL rather than only one sign language.

### 2. Live assistant expectation

The user clarified that they did not merely want a camera form. They wanted a **ChatGPT voice mode / Gemini Live-like sign mode**: interact through signs, receive meaningful output, and hold a conversation. They asked for real-time tests and the best technical implementation.

Early behavior reportedly produced only HELLO in all screens. The user repeatedly asked for other signs, training and actual recognition. Later failures included BOOK and DRINK. One earlier answer said DRINK worked, but the user subsequently corrected it: DRINK did not detect, while HELLO/STOP sometimes appeared. Do not count the earlier answer as a validated DRINK success.

### 3. Debugging and reliability complaints

The conversation contains a Vite `aborted` HTTP stack screenshot, repeated `ERR_CONNECTION_REFUSED` screenshots, camera permission/busy problems and confusion about why the site was not opening. The user repeatedly asked to open/restart the site and continue.

Consequences for the next agent:

- Verify listeners and health, not merely a remembered URL.
- Distinguish dev server failure, camera failure, capture failure, model rejection and speech failure.
- Do not repeat “camera busy” unless the current target browser actually reports it. Earlier, Chrome could use the camera while the Codex preview could not.
- A visible preview is only the first stage.

### 4. Hardware and software priorities

The user had roughly one month in an earlier planning discussion and wanted a distinctive, advanced project. They asked whether hardware could help, gave a budget of ₹1,500, then explicitly prioritized advanced software. Braille compatibility and a self-built single-cell Braille prototype were discussed as a future phase.

Do not introduce hardware procurement into the immediate recognition/debugging task. Do not claim a Braille test or device has already been built.

## B. Human communication became the central requirement

### 5. Preferences instead of disability categories

The user listed scenarios involving people who cannot hear, see and/or speak, then specifically said **do not categorize people**. The project should connect people professionally, letting each choose suitable inputs and outputs.

Accepted direction:

- Inputs: Type, Speak, Sign.
- Outputs: Text, Read aloud, Sign video, Screen reader.
- People choose their own preferences independently.
- Someone unable to see/hear/speak needs an appropriate tactile interface and accessible input; ordinary speech/video cannot magically address every combination. That hardware work remains later.

### 6. Explicit software-first 30-day plan

The user pasted and explicitly asked to implement this sequence:

| Phase | Intended period | Deliverable |
|---|---|---|
| Connect people | Days 1–7 | Home Start/Join/preferences, invitation, two-person room, shared text, connection state; history survives preference changes. |
| Live sign and voice | Days 8–14 | WebRTC local/partner video, camera/mic controls, reconnect and relay; no AI key needed for calls. |
| Connect chosen input/output | Days 15–21 | Editable dictated transcript; local sign recognition → review → Send; received text → read aloud/screen reader/saved phrase video. |
| Accessibility and reliability | Days 22–30 | Mobile layout, keyboard/captions, accessible flow, device errors, reconnect and repeatable demo. |

Technical decisions included standalone Node + ws serving the React build; a `/#connect` screen; opaque invites; two members; reconnect credentials; expiry after 30 minutes empty; latest 200 messages in server memory; stable IDs for deduplication; server-assigned sender/order; drafts survive disconnects; room restart visibly ends the old room.

Separate human-message and assistant states were required because the older assistant hooks can call AI automatically. Camera stream ownership should be shared correctly between recognition and a call; leaving ends owned tracks. Speech input must not capture the app's read-aloud output.

Public demo excludes laptop research models. Missing models/videos must have truthful availability states. Continuous sentence translation remains later work.

The proposed free infrastructure was Render Free plus a free Metered Open Relay allowance. Account setup was needed; the user said Render was ready, later clarified the service was not yet created. No paid upgrade was authorized.

Acceptance list: 20 alternating messages on two real devices, cross-network video/audio including forced relay, invalid/expired/third-user rejection, typing after camera denial, draft-preserving reconnect, no duplicate voice/announcements, human communication without Gemini, automated checks with actual-device results reported separately.

### 7. Novelty and “10/10” requests

The user asked for idea/feature ratings, originality and a plan to make it “10/10.” A later pasted document described a working differentiation hypothesis around an integrated conversation flow. Do not claim world-first novelty or a guaranteed score; focus on the practical interaction, correction/clarification, message context and accessible delivery.

Historical pasted attachment:

`C:\Users\adjay\.codex\attachments\c8bc67a8-b117-4d37-bad3-3f8912cf9be7\Pasted text.txt`

That attachment's complete content was not re-read during this handoff; use current project documentation for implemented behavior rather than inventing its details.

## C. Repeated mismatch between user expectation and the existing UI

### 8. Camera-on was mistaken for recognition-on

A screenshot showed a live local preview and the separate **Enable local word recognition** switch off. The user complained their hand was not recognized. The UI required too many separate choices to make the next action obvious.

Later the user said the site was hard to use and they did not know where features were. Do not add another technically labelled screen without an obvious path from the normal home/conversation flow.

### 9. Review/add/send versus immediate visible text

The old flow was roughly camera capture → tentative word → review/correct → Add word → draft → Send. The user expected text and voice as soon as they signed. This distinction caused repeated “detect aagudhu, response illa” complaints.

Current state still distinguishes:

- recognized result/review field;
- composed message textarea;
- local speech;
- actual partner send;
- optional AI reply.

The immediate pending convenience gap is automatic accepted-word insertion into the composed message. Do not solve it by sending uncertain words to another person or presenting an AI-generated sentence as direct sign translation.

### 10. User's joint-graph idea

The user asked for an honest assessment of training connected hand/body joints rather than thousands of images. They wanted a model which watches camera input and converts signs to text/voice.

The project developed pose/graph features, research training scripts, evaluation controls and Training Studio collection. The user then said they did not know sign language or any signer, and asked what the assistant could do versus what they needed to do.

Practical implication: use attributable, permitted, labelled sources and verified demonstrations; collect explicit no-sign ordinary motion separately; do not tell this user to invent sign labels. Actual fluent-signer validation remains missing.

### 11. Examples and testing confusion

The user asked for a symbol/image to test, rejected an example, and reported BOOK did not work. Later they specifically asked to search sign-language images/videos and train properly. Dynamic signs need temporal evidence; a single still picture cannot validate an entire movement.

Any visual example must identify the sign language/variant/source. Artificially generated hands or a shortcut pose are not verified language training examples.

## D. Voice-session clarifications that must not be lost

### 12. One signer and one person who does not sign

In voice sessions the user restated the core scenario several times:

> One person knows sign language. Another does not. We must make their communication easy.

They were confused because the app seemed to capture but not produce meaning. The assistant explained that the flow existed but model reliability did not. This distinction remains true.

### 13. Assistant and translator are both desired

The user said the system should behave as an AI agent and as a translator. The agreed conceptual split was who receives the message:

- Partner destination: preserve and deliver the user's meaning.
- AI destination: send reviewed text for an assistant reply.

Example discussed: “I want water” signed to a partner should reach that partner as the request; to an AI, it can receive an assistant response. AI generation is not a substitute for understanding the sign correctly.

### 14. They explicitly approved continuing implementation

The user asked for a short plan, said think broadly while implementing, then told the assistant to continue. The priority agreed was limited supported signs with evidence, then scale. Do not keep returning only plans when the next implementation turn asks for execution.

### 15. Reverse direction and limited reading fluency

The user asked the assistant to test from the perspective of someone who can see but cannot hear/speak and has limited education. They clarified they had been testing both people themselves in tabs.

Their expectation:

- Signer → non-signer: sign meaning becomes text + voice.
- Non-signer → signer: speech/text becomes a comprehensible sign reply.

The source walkthrough found heavy English text, review complexity and incomplete sign-video coverage. It did not establish lived disability experience or a real participant success rate. Simply receiving text is not enough for someone who cannot comfortably read it.

## E. Referenced projects and what was actually reused

### 16. AvishakeAdhikary LSTM project

User link:

`https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model`

The user asked for full analysis, not a quick dismissal as “only three words.” Saved analysis found useful collection/training/live-prediction ideas, but conflicting three-label notebooks (HELLO/THANKS/ILOVEYOU versus CAT/FOOD/HELP), missing reliable label manifests, small/random evaluation, inadequate unknown handling and dependency conflicts.

It was a research reference, not a ready universal translator. Existing saved weights were not silently installed. A separate LSTM comparison path on the existing versioned joint contract was developed. Exact detail: `docs/external-lstm-full-analysis-2026-10-08.md` and `docs/temporal-lstm-control-2026-10-08.md`.

### 17. farihaNaqvi MediaPipe ISL interpreter

User link:

`https://github.com/farihaNaqvi/MediaPipe-ISL-Virtual-Interpreter`

The user asked to improve SignBridge using it and requested deep research. Saved review describes a five-label sign classifier, separate four-label desktop commands, and five GIFs. It found first-result UI issues and silent omission of unsupported reverse-lookup words.

SignBridge changes informed by that review included focus/scroll to completed results, improved saved-phrase coverage planning, preservation of missing words/negation and coordinate-provenance checks. The external code/weights/GIFs were not simply copied into the app. See `docs/isl-reference-improvements-2026-10-09.md`.

## F. Deployment history

### 18. User authorized GitHub and Render work

The user asked how another device could use a localhost app, asked about GitHub, and explicitly authorized pushing and full deployment. They repeatedly said “you do it,” because Render instructions were confusing. Screenshots eventually showed a logged-in Render dashboard in the Codex browser.

Distinguish authorization from actual access/success: older assistant utterances sometimes promised deployment before tool verification. Use the saved deployment report and current service checks, not those promises.

### 19. Public pilot eventually existed

Historical report dated 8 October records Render Free deployed at `https://signbridge-conversations.onrender.com/#connect`, source branch `codex/render-pilot`, draft PR `https://github.com/ADjayantan/signbridge-/pull/1`.

Build first failed because production npm install omitted Vite. It was corrected to include dev dependencies and run `build:public`. The public pilot passed synthetic remote room protocol checks and a browser text send. TURN was unavailable then; physical-device/forced-relay/media recognition trials were not proved.

Current local code is not automatically deployed, and public builds omit research models. The GPU in this laptop is not available to a phone merely because Render hosts the room server.

### 20. Parallel AI collaboration

The user wanted Codex and another AI to work on the same project. Proposed split was recognition/evaluation versus app/conversation UI. Preserve shared data contracts, ownership and source state. Do not have both models edit the same files concurrently without coordinating.

The user requested a full handoff to Gemini Argon, then returned asking to review Argon's work. Their later clarification said Argon had **analyzed the same folder**, not created a separate replacement project. Do not hunt for an imaginary second Gemini checkout.

## G. Recognition investigation and evidence timeline

### 21. HELLO speech tests were not all real recognition tests

Some tests sent a synthetic recognized HELLO through the room/speech flow. Browser voice completion was observed. The user answered that they had not listened/tested it. These establish neither camera recognition nor physically audible sound.

Keep that distinction in reports. Replaying a speaker button cannot fix a rejected sign.

### 22. Dark camera resolved separately

An integrated webcam preview was dark. The assistant suggested checking the physical shutter/privacy control; the user later confirmed the preview was visible. That resolved camera visibility, not model recognition.

### 23. Three.js design request

The user requested an aesthetic Three.js UI. Decoration and a redesigned workspace were implemented. Screenshots showed colorful hand joints and the text/voice sections, but no word. The user clarified they expected camera-on signing to produce text/voice without manually pressing Capture and Finish.

Prioritize recognizing actual signs and reducing cognitive load; do not spend the next iteration solely redesigning an already attractive nonworking recognizer.

### 24. Automatic capture did not fix recognition

Automatic capture was added. Live trials still showed “No reliable word match.” The user noted movement triggered capture while a still hand did not. Held-pose support was later added; it now exists in current source. Capture boundaries and semantic recognition are separate.

### 25. Wrong-language vocabulary confusion

An ASL attempt yielded a weak CANDY guess. The user asked how to sign CANDY, then said they would look it up and the assistant should continue fixing the code. Inspection found the active ASL 100-word vocabulary lacked HELLO. The user explicitly selected ISL.

Even ISL HELLO then failed, weakly suggesting FATHER below acceptance. HELLO existing in a label list does not make webcam recognition reliable. The camera delivered 640×480 during earlier testing; a possible aspect-ratio/coordinate mismatch was investigated but not established as the single proven cause.

### 26. Usage-limit pause and resume

The user paused when account usage was around 3%, later explicitly resumed after reset. There is no current request to remain paused. Historical “continue later” should not block continuation now.

### 27. Research candidates did not pass promotion gates

Several archived-pose and current-detector studies were run. Their results and failures were recorded. Improving top-one predictions did not necessarily improve safe accepted coverage or rejection of unknown movements. Candidates were retained as research artifacts rather than falsely promoted.

See the master prompt for exact measured results. The frozen studies must not be overwritten or relabelled as successful live-user evaluations.

### 28. Move to F: and provenance work

By 22 October the active checkout was `F:\Downloads\signbridge`. A screenshot of Downloads also contained other folders; the old `signbridge-fixed` was explicitly excluded as the current project.

Capture metadata was added so exports retain actual decoded dimensions, detector identity, coordinates, timing configuration and mirror assertions. The importer blocks incompatible partial/mixed capture domains rather than silently combining them. No new word model was trained by that metadata change.

### 29. First clear video → HELLO → browser speech demonstration

On 22 October a real known INCLUDE HELLO video was processed by the browser pose pipeline. It produced HELLO with score .983657718, and browser speech completed. That is a useful visible demonstration but still a known reference, not proof of arbitrary webcam recognition.

The Sign video input uses actual decoded frames, not filenames or supplied labels. Local example loading was subsequently added with bounded downloads and a separate Convert action. Latest focused UI tests for this input passed during the 26 October handoff audit.

### 30. Gemini's exact analysis supplied by the user

The user reported the following analysis for the same `F:\Downloads\signbridge`:

1. Webcam wrist at `y >= .98` triggers clipped/reset in automatic capture; shoulder visibility also drops.
2. Existing ISL model learned full-body/standing source videos; a close-up open palm on either hand gives low scores, often <.30.
3. Recognized output stays in Step 2 review; Step 3 textarea is not automatically appended; speech depends on the toggle/action.

Our fresh audit confirms relevant gate/output code, but the exact measured low-score/live-capture circumstances still require recorded replication. Preserve this as supplied analysis, not proof that a single shortcut fix is sufficient.

## H. New WLASL setup and current incomplete work

### 31. User supplied a large local ASL dataset

The latest important addition is `C:\Users\adjay\Projects\WLASL`, with videos, source, action-pretrained weights, checkpoints and logs. User's handoff described 11,301 of 21,083 clips, 2,000 total release words, WLASL100 training and 24 old-code fixes.

This provides real assets to inspect and use; it does not establish a trained reliable model. It is ASL, not a replacement for ISL HELLO. Complete Claude artifact contents were not retrieved.

### 32. Actual training checkpoint was weak and stopped

Audit found one old checkpoint with ~2.37% top-one on 169 available test examples; log stopped during epoch 2. Original trainer merged train+validation and used test repeatedly. No training process was running at the latest inspection.

Do not keep telling the user it is training or nearly finished. Do not confuse action-pretrained backbone weights with a trained sign vocabulary.

### 33. Official weights and separate new trainer

Official pretrained WLASL100 weights were downloaded from the repository's own link into local research storage, with a pinned hash. Separately, a cleaner RGB trainer with real train/validation/test separation and resumable metadata was implemented and unit-tested.

These are **different model/preprocessing families**. The new trainer has not run a new training job yet. Its checkpoints cannot silently replace the old official BGR checkpoint.

### 34. Partial app integration is unfinished

Python inference, local Node middleware, an ASL upload/camera screen and tests were created. App route/navigation/Vite plugin registration were not finished. An actual BOOK validation clip produced FAMILY under the current adapter; preprocessing does not match the official default evaluation path.

A fresh handoff audit also found a model-name middle-dot validation mismatch, a middleware socket-reset test failure and a UI timer-cleanup test failure. These are documented explicitly in the master prompt. Do not label the WLASL feature working or the full check passing.

### 35. Latest request is this handoff

The user now asks for the conversion/conversation history, project location, project description and **small details in a master prompt so Gemini Argon can continue clearly**.

This turn therefore produced documentation and fresh read-only verification, not a new training run, deployment, or finished recognition integration. Argon should continue from the documented state when instructed, with the exact unfinished steps and failures visible.

## I. Communication habits to carry forward

- Lead with what changed or what actually failed. “Checking” repeated without findings frustrated the user.
- Avoid declaring success after unit tests while real recognition remains wrong.
- Keep explanation short in conversation, detailed in the report. The user repeatedly said “puriyala” when jargon or too many steps obscured the next action.
- Open a working page and show real output when implementation is ready. Do not just give a localhost link to an inactive server.
- Keep human conversation as the central purpose. AI help, training screens and decorative 3D are supporting tools.
- State which language/model/vocabulary is selected. Never let the user keep testing an unavailable word without explaining why.
- Ask for a live trial only when the page and supported reference are actually ready. Do not repeatedly ask whether they heard sound when they already said they had not tested it.
- A user correction overrides an earlier optimistic test answer. DRINK was later reported failing; note failures honestly.
- Do not ask them for the project location again. It is known and verified.
- Do not promise a general translator from one open palm demo. Build a bounded working result and state its limits.

## J. Historical source references

| Reference | Role / status |
|---|---|
| Initial Claude share `https://claude.ai/share/fc8dec45-6175-4603-895d-b0a3e635579c` | User's starting shared project conversation; full content not retrieved during this handoff. |
| `https://github.com/AvishakeAdhikary/Realtime-Sign-Language-Detection-Using-LSTM-Model` | Reviewed LSTM reference; see saved full analysis. |
| `https://github.com/farihaNaqvi/MediaPipe-ISL-Virtual-Interpreter` | Reviewed ISL workflow/model reference; no validated wholesale import. |
| `https://github.com/dxli94/WLASL` | Current local ASL I3D/data source. |
| `https://claude.ai/artifact/4CbNkWb4kGkSkNqTnGZ6oB` | User's WLASL setup document; supplied summary used, complete artifact not read. |
| `https://github.com/ADjayantan/signbridge-` | SignBridge Git remote; working disk contains substantial newer uncommitted work. |
| `https://signbridge-conversations.onrender.com/#connect` | Historically deployed conversation pilot; not current local GPU recognition. |

The master prompt lists the current file map, hashes, evidence, startup commands, failures and next implementation order. Use that operational information before changing code.
