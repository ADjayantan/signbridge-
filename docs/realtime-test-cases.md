# Live Sign real-time test cases — 1 October 2026

**165 app tests pass (95 Node + 70 React/media), plus 25 Python training checks; the production/PWA build passes.** Actual browser checks verified the laptop camera and local video workflow. Full ISL/ASL interpretation, live AI answers, audible speech and their latency remain unverified because this server has no `GEMINI_API_KEY` configured and no fluent signer was available for these trials. The trained-word mode works without that key; its separate dataset results are in [the training report](model-training-2026-10-01.md).

Environment: Windows, Node 26.8.1, localhost `http://127.0.0.1:5173/#live-sign`, Codex in-app Chromium, Integrated Camera (04f2:b7b9). Camera footage was kept local, not sent to Gemini or added to the sign-video library. Imported playback fixtures were synthetic videos, not signing examples.

## Checks completed

| ID | Action | Observed result | Evidence / status |
| --- | --- | --- | --- |
| B01 | Start sign session with automatic camera selection | Integrated Camera selected; playing 640×480 video, readyState 4 | Actual browser: pass |
| B02 | Start a camera turn and let it reach its limit | Stops at 12.0 seconds; 640×480 preview decodes with no video error | Actual browser: pass |
| B03 | Record again, then Interrupt | Recording cancels, preview disappears, next turn is available | Actual browser: pass |
| B04 | Import a damaged MP4 | “This video can't be decoded. Try a short MP4.”; recording becomes available again | Actual browser: pass |
| B05 | Import a playable synthetic MP4 | 1-second, 320×240 preview decodes, readyState 4 | Actual browser: pass |
| B06 | Check sharing consent for the synthetic clip, then replace it | New clip has unchecked consent and blank meaning | Actual browser: pass |
| B07 | Change ISL to ASL with a draft clip | Session ends; draft disappears; camera element returns to readyState 0 and 0×0 dimensions | Actual browser: pass; native track cleanup separately covered by hook tests |
| B08 | Use interpretation/confirmation without a configured key | Setup instructions visible; AI actions disabled even with consent; local capture remains available | Actual browser and localhost status endpoint: expected block |
| A01 | Press Space while import inspection is pending | Recording cannot start | Regression reproduced failing before fix, passing after fix |
| A02 | Submit typed text while import inspection is pending | No AI call; typed draft retained | Simulated UI: pass |
| A03 | End during import, start another session, then resolve old import | Old result cannot replace the new camera turn | Simulated UI: pass |
| A04 | Interpret an old clip while replacement inspection is pending | No interpretation call; replacement requires fresh consent | Simulated UI: pass |
| A05 | Hold an unknown open palm with default local-recognition settings | No HELLO word or speech; unknown-match feedback visible | Simulated UI: pass |
| A06 | Enable shortcuts, then hold palm / thumbs up / thumbs down / pointing up | HELLO / YES / NO / WAIT each append and request speech | Simulated UI: pass; actual audibility not measured |
| A07 | Recognize saved WATER and HELP handshapes with shortcuts off | Both distinct labels append and request speech without an AI call | Simulated landmarks/UI: pass; not ISL/ASL accuracy |
| A08 | Turn shortcuts off during a partial hold or pending auto-send | Partial word is reset; existing reviewed words are retained and auto-send is disarmed | Simulated UI: pass |

The actual browser was left on Live Sign with ISL / English selected, camera off and no draft clip. This screenshot confirms the final state and the missing-key blocker; it is not evidence of sign recognition accuracy.

*Archived test capture omitted from this public source snapshot.*

## Set up a real signing trial

For **local trained words**, open `http://127.0.0.1:5173/#trained-sign` and select ISL or ASL. Use only displayed vocabulary: ISL examples include THANK YOU, GOOD MORNING, HAPPY and CELL PHONE; ASL examples include HELP, DRINK, MOTHER, YES and NO. Start the camera, capture one complete word, then Finish. Write down the intended word before each attempt and record accepted, wrong and rejected results separately. Repeat each word three times, then include words outside the vocabulary and hand-free turns. Try different lighting, distances and signers. Keep automatic speech off until results have been reviewed. These trials need no Gemini key and do not send footage to the cloud.

Actual trained-mode checks passed: both vocabularies loaded; Integrated Camera played at 640×480 with Holistic ready; a hand-free capture returned **No clear signing found**, blank meaning and disabled speech; Cancel cleared a new turn; End reset the video to readyState 0 and 0×0. These are workflow/negative-case checks, not positive recognition accuracy. Fluent-signer word trials remain unperformed.

For **Live Sign's cloud sentence interpretation**, use the following procedure:

1. Add the server key as `GEMINI_API_KEY` in the ignored `.env.local` file and restart `npm run dev`. Keep the key out of screenshots and test logs.
2. Open `http://127.0.0.1:5173/#live-sign`. Select **ISL** or **ASL**, and choose a reply language you can evaluate.
3. Use a fluent signer for that language. Write down the intended meaning before recording; use natural signing, including face and body cues. English examples below specify meanings, not instructions to sign English word order.
4. Start the session. Keep face, upper body and both hands visible. Record a 3–8 second turn, then click **Finish signing**. Maximums are 12 seconds / 2 MB.
5. Preview the clip. If you choose to share that recording with Google Gemini, check its consent box and click **Interpret my signs**. Record the tentative result before correcting it.
6. Correct the meaning, then click **Confirm meaning & get reply**. Read the answer; enable optional speech or matching saved sign videos if those are part of the trial.

Repeat the following trials separately for ISL and ASL, with three recordings per signing example. A language selector does not prove recognition quality; use the fluent signer's assessment as ground truth.

## Real-sign and conversation cases

| ID | Input / action | Expected behavior / what to record |
| --- | --- | --- |
| R01 | A natural greeting meaning “Hello” | Tentative meaning preserves the greeting. Record correct / incorrect / unclear for each repetition. Reply appears only after confirmation. |
| R02 | “I need water”, then a separate turn meaning “I do not need water” | Negation remains distinct. Losing the negative is an interpretation failure, even if the reply sounds reasonable. |
| R03 | A familiar two-handed moving sign or short sentence with meaningful facial expression | Signer judges the full meaning, movement and nonmanual cues. Hand-tracking landmarks alone are not a pass. |
| R04 | Empty frame; then ordinary movement that is not signing | Prefer `no_sign` / `unclear` and blank meaning. Inventing a signed message is a failure. |
| R05 | Repeat a known example with partly hidden hands, dim light, then faster signing | Record uncertainty and errors. Incorrect confident text is a failure; an unclear result must allow manual entry. |
| R06 | Use an ASL example with ISL selected, and vice versa | Record the actual result. Do not assume the model can reliably reject the wrong language; any incorrect confident interpretation counts as a failure. |
| R07 | Leave clip consent unchecked; then replace a clip whose consent was checked | Interpretation remains unavailable until this clip receives consent. Fresh clips must start unchecked. For this privacy check, use a synthetic clip and inspect the browser Network panel: no `sign-video` POST should occur while unchecked. |
| R08 | Change a tentative meaning to “Please tell me a short joke” before confirmation | AI answers the corrected message. No answer should be generated from the discarded tentative meaning. |
| R09 | Confirm “My favourite colour is blue”; next ask “What colour did I just mention?” | Answer uses the completed prior turn. An interrupted or failed turn must not become completed history. |
| R10 | Interrupt while interpretation or an answer is pending, then record a new turn | New turn works; late results cannot replace it or start delayed speech. |
| R11 | End session during recording; start again | Preview and draft are cleared; camera turns off, then reconnects on the next Start. |
| R12 | Type a short turn and submit with Enter | It follows the same conversation history and reply flow. During a pending import, Enter/Space cannot bypass blocked actions. |

## Speech, reply clips and failure cases

| ID | Action | Expected behavior / what to record |
| --- | --- | --- |
| M01 | Fill reviewed meaning, click **Speak my message**, then Stop speech | A listener checks the spoken words and chosen language; stopping silences output. Availability of the button does not prove audible output. |
| M02 | Save a fluent-signer-reviewed clip in the selected language for an exact reply phrase | Matching reply plays that phrase's clip. Switching ISL/ASL must not play the other language's library. These clips are supplied by the user; none are bundled. |
| M03 | Receive a reply with words absent from the library | Missing signs remain visible as text; playback pauses rather than pretending the whole reply was signed. Concatenated clips do not establish fluent sign-language grammar. |
| F01 | Deny camera permission, or disconnect the camera during recording | Readable camera error/retry; no misleading successful capture. Retry works after camera access is restored. |
| F02 | Import a damaged, oversized or longer-than-12-second video | Rejected with a useful error; no AI upload; another valid turn still works. Damaged-file recovery was checked in the actual browser; other bounds are covered by automated tests. |
| F03 | Lose network during an AI request; restore it and retry | Readable error; confirmed meaning retained where applicable; no automatic retry loop or stale answer. Automated behavior passes; real upstream failure recovery is pending. |
| F04 | Upstream reports invalid key, quota limit or timeout | Useful error with retry path; no fabricated interpretation. These paths are simulated in tests; they still need a configured-service trial. |
| F05 | After initial caching, reload offline | Local tools and saved clips remain usable; AI interpretation/replies report failure. Offline app/runtime/playback was verified separately in the general verification report. |

## Record results without mixing them

Capture these values for each trial:

| Trial | Language | Intended meaning | Tentative meaning / status | Correct, incorrect or unclear | Corrected meaning | Interpretation ms | Answer ms | Speech / clip result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01-1 | ISL | Hello | | | | | | |
| R01-1 | ASL | Hello | | | | | | |

Measure **interpretation latency** from clicking Interpret to meaning/status appearing; measure **answer latency** from Confirm to reply appearing. Keep recording and human review time separate. Count correct, incorrect and unclear interpretations separately and report total trials; do not count an unclear result as a correct translation. Also record how often the user needed to edit the meaning.

Live Sign currently processes short completed video turns. It does not continuously translate a camera stream like native voice mode. No live AI latency or signing accuracy number has been measured in this run. Passing UI tests establishes the conversation mechanics, not a trained sign-language model.

Run `npm run check` for the automated suites and build. Broader previous checks are recorded in [verification-2026-10-01.md](verification-2026-10-01.md); model limitations and requirements are in [live-sign-design.md](live-sign-design.md).

## If it only says HELLO

The previous local fallback mapped an open palm to HELLO. Many unknown signs contain open hands, so that shortcut could look like translation while ignoring the rest of the sign. Shortcuts now start off, and the camera panel shows exactly which personal static signs are saved. The inspected ISL browser had **0 saved signs**, so it had no personal vocabulary to recognize. No user training was deleted.

*Archived test capture omitted from this public source snapshot.*

For a local static-handshape trial, choose **Teach a new sign**, enter a word, record its held handshape, and repeat from a slightly different angle. Return to Talk and enable **Speak each recognized sign**. Train distinct handshapes for distinct words; changing position alone is insufficient for this classifier. For a shortcut-only demo, explicitly turn on **Use gesture shortcuts** and try thumbs up / thumbs down / pointing up for YES / NO / WAIT. Those are shortcuts, not fluent sign-language recognition.

For a moving or sentence sign, use Live Sign's completed-video interpretation after configuring the server key. Its hand-tracking preview alone does not produce words. Interpretation is still experimental and needs signer evaluation; the application does not include a validated full ISL/ASL model.
