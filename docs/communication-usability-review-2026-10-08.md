# Communication usability review — 8 October 2026

## Main finding

SignBridge currently needs substantial written-English reading to start, confirm and recover a conversation. For a person who cannot hear or speak and also has limited reading fluency, independent communication is not yet demonstrated. The largest barriers are confirming the recognized meaning and understanding the partner's reply, even when the camera works.

Limited reading fluency is a separate scenario assumption, not a consequence of being unable to hear or speak. No disability experience was simulated as lived experience.

## Method and limits

- Read-only source and task walkthrough, starting at `/#training-studio` and following Home, the sign workspace, conversation rooms and saved sign videos.
- 91 UI tests across five suites and 7 sign-video/storage Node tests passed. These check functional behaviour with simulated inputs; they do not measure recognition accuracy or user comprehension.
- Earlier automatic approval review blocked live-browser access. No live browser, webcam, real signer, screen-reader, contrast or zoom test was performed for this review.
- Observed software behaviour below is separated from predicted user difficulty. No usability success rate or accessibility compliance claim is made.
- No application code was changed during this review.

## Task findings

| Priority | Task | Observed behaviour | Likely difficulty | First improvement |
|---|---|---|---|---|
| Critical | Understand a partner's reply | Saved sign videos are off by default, stored locally per browser and depend on matching clips. Missing coverage falls back to text. | A person who cannot comfortably read the reply has no dependable accessible meaning. Read aloud cannot help this scenario. | Provide a verified essential phrase library, clearly show its coverage and offer a visual request to repeat or clarify. |
| Critical | Send a sign with the intended meaning | The user must review an English prediction, edit if needed, add it to a draft and then Send. Unavailable recognition offers typing or direct video. | The user cannot reliably verify a prediction they cannot read. Direct video does not explain the sign to a partner who does not know it. | Add visual confirmation for verified supported meanings, with an obvious uncertain/unsupported state. Preserve deliberate review; never send uncertain predictions automatically. |
| High | Find the conversation | The current Training Studio page collects samples; its main action opens the sign workspace. It has no room or message delivery. | A new user can mistake recording a sample for communicating, then wonder where it went. | Put Start/Join conversation first in normal use. Keep data collection in clearly separate optional tools. |
| High | Start signing | Defaults are Type/Text/English. Choosing Sign still requires a separate camera action and recognition switch. The language selector does not translate the English interface. | The user can select Sign and wait for translation without understanding the remaining steps. | A short visual setup guide, simple local-language labels and one clear next action at each step. Keep explicit camera permission. |
| High | Capture and recover | Capture/Finish timing and framing guidance are written instructions. Model selectors, joint counts and diagnostics sit beside essential actions. Error recovery is text-led. | The user may not know when to move, finish or retry, or which button sends a message. | Verified signed/visual demonstrations, a clear recording cue and simple retry guidance. Move technical details into a closed advanced panel. |
| Medium | Revisit replies and get help | The room's saved-sign player follows only the latest received message. Opening a tool leaves the active room, with a written explanation. | Earlier visual replies are harder to revisit; seeking help can disconnect the partner. | Per-message replay where a clip is available and room-preserving help, with a clearly recognizable Leave action. |

## Evidence in the current source

- Defaults: `src/hooks/useCommunicationPreferences.js:5`.
- Home navigation and tool descriptions: `src/modes/Home.jsx:16`, `:25`.
- Training Studio capture destination: `src/modes/TrainingStudio.jsx:109`.
- Conversation preferences and language labels: `src/modes/ConnectMode.jsx:234`–`:237`; camera controls at `:244`; separate recognition switch at `:253`.
- Recognition review sequence: `src/components/RoomSignCapture.jsx:109`, `:126`, `:129`, `:135`, `:139`; message review and Send at `src/modes/ConnectMode.jsx:251`.
- Saved-video matching: `src/lib/signVideos.js:14`, `:35`; missing-video fallback: `src/components/SignVideoPlayer.jsx:50`, `:54`.
- Latest-reply player and local-library notice: `src/modes/ConnectMode.jsx:257`–`:258`; leaving through Tools at `:266`.
- Capture guidance in the standalone workspace: `src/modes/TrainedSignMode.jsx:218`–`:236`.
- Optional no-sign collection bookkeeping and consent: `src/components/NonsigningCapture.jsx:99`. This saves research samples locally; it does not translate, retrain or send a message.

## Existing helpful behaviour

Camera and microphone have explicit controls. Live video, local preview and visual framing feedback exist. Recognition never sends a tentative word automatically. Preference changes preserve history and drafts; failed sends and disconnects preserve drafts and retry IDs avoid duplicate messages. Clarification and corrections keep context. Saved clips have replay and slower playback, and missing words are not silently skipped. Several optional sections already start collapsed.

These are useful foundations, but live video alone cannot bridge a signer and a partner who does not know signing. Visible hand joints also do not establish that the sign's meaning was recognized correctly. Earlier BOOK and DRINK failures remain relevant; natural continuous sign translation is not validated.

## Recommended order

1. Make the person-to-person conversation the obvious first destination and show a visual setup path.
2. Prove a small, honestly labelled set of supported meanings with fluent sign-language review. Give both sender and recipient a visual way to understand each verified meaning.
3. Improve reply coverage, replay, clarification and error recovery before adding more laboratory controls.
4. Observe consented first-time users with limited reading fluency and fluent ISL/ASL users. Check whether they can join, send the intended meaning, understand a reply, request clarification and recover after an error without reading instructions from a helper.

A valid user test must distinguish app operation from model correctness. Passing UI tests cannot establish either recognition accuracy or independence for this scenario.
