# SignBridge — conversation quality plan

Prepared 2 October 2026. Proposed 30-day software scope; new features below are not implemented by this document.

Implementation update, 3 October 2026: the clarification/correction, meeting-revision and text-reference workflows have now been built locally. See [implementation verification](conversation-quality-verification-2026-10-03.md), [the recorded comparison](workflow-comparison-2026-10-03.md) and [the prepared user pilot](user-pilot-protocol-2026-10-03.md). Render service creation, relay configuration, physical devices and consented-user outcomes remain pending. The schedule and targets below are the original plan, not completed participant results.

## Outcome

Help two people locate an unclear message, repair it, and agree on practical details using their chosen communication modes. Keep one conversation screen and per-device input/output choices. Do not label people by disability categories.

The target is an excellent, demonstrably useful student project. A 10/10 rating is subjective. Worldwide novelty, unrestricted sign translation and universal accessibility cannot be established by adding features or by this plan.

The signature demonstration is a meeting arranged through signing, reviewed text and accessible output: a partner asks which entrance was meant, the sender clarifies, both review a meeting card, and a later time change requires fresh approvals.

## Starting point and priority change

The [verification report](conversations-verification-2026-10-02.md) records implemented rooms, reviewed messages, device preferences, WebRTC, local sign capture, output availability, reconnect and accessible controls. It records 162 Node and 139 UI tests and local two-tab browser checks. Those are previous results, not a new test run for this document.

Public deployment, actual Windows/Android devices, different networks, audible audio, speech transcription, NVDA/TalkBack and forced TURN relay are still pending. Render is ready; Metered setup and test participants are dependencies.

The [earlier model roadmap](software-roadmap-2026-10-02.md) remains useful for a separate recognition study. This month prioritizes reliable human conversation and evidence of usefulness. New model training moves later unless separately staffed; the existing isolated-word models remain experimental. Natural ISL/ASL video calls do not depend on recognition and do not translate between those languages.

## What is distinctive, and what needs evidence

Public product pages already describe broad parts of the original idea:

| Reference | Existing offering described by its publisher |
| --- | --- |
| [Sign-Speak](https://www.sign-speak.com/faq) | ASL video captions and speech-to-ASL avatar output. |
| [Let'sTalkSign](https://www.letstalksign.org/lts/products/liapp.php) | Spoken/typed text to sign, text to speech, and Tamil among supported spoken/text input languages. |
| [Kara Technologies](https://www.kara.tech/) | Human review and refinement of sign translations. |

These pages are evidence of advertised feature classes, not independent accuracy evaluations. Generic conversion, an avatar, language selection or a review checkbox cannot support a globally new claim.

The working differentiation hypothesis is the integrated flow: message-specific repair, preserved corrections, exact-revision agreement and accessible delivery inside the same conversation. In Days 1–4, record a comparison matrix against these public workflows and relevant research. Mark undocumented competitor capabilities as unknown, not absent. Present the final contribution as a designed and tested workflow; do not use “world first.”

## Options considered and selected

| Approach | Decision for this month | Reason |
| --- | --- | --- |
| Clarification attached to a particular message | Core | A small addition to ordinary conversation that directly addresses misunderstanding. |
| Joint meeting details with revision-specific approval | Core | A clear, testable way to catch conflicting time/place details. |
| Shared labeled references | Conditional | Helps with “this/that”; begin with text and descriptions, not uploads. |
| Pair-approved personal gesture vocabulary | Later | Consent, language labeling and reliable recall need a separate pilot. |
| Short signed clips for poor connections | Later | Adds media transfer, storage and consent work to an already unverified network baseline. |
| Automatic extraction of agreements by AI | Later | Requires evaluation and cannot become authority for what either person agreed. |
| Remove automatic translation from the primary promise | Adopt as a product boundary | Direct video, reviewed messages and available verified phrases remain useful without AI. |

The inversion is to ask the receiver to optionally restate an unclear meaning rather than relying entirely on the sender's recognition preview. This is selective, not a mandatory confirmation after every message.

## Core feature behaviour

### 1. Clarify and correct a message

- A received message has an optional “Clarify this” action. Offer “Repeat,” “Which time/place?” and a short editable question. It refers to that specific message.
- The sender answers through the existing reviewed draft and explicit Send. Keep the answer linked to the request and original message.
- A correction is a new linked message. Preserve the original wording; only its sender may issue a correction. The other participant may suggest a change.
- The requester may mark the request resolved. Display “Partner marked this resolved,” which describes their action and is not independent proof of comprehension.
- Ordinary Send remains a single action. No automatic AI answer, forced understanding checkbox or automatic camera recording is introduced.

### 2. Review and agree on meeting details

- Begin with one optional template: date, time, time zone, place and note. People fill/review it themselves; automatic extraction is unnecessary.
- Either participant can propose an edit. Each participant approves only for themselves and only the exact current revision they viewed.
- A change to any field creates a new revision and clears both approvals. Preserve prior versions in the room's bounded history.
- Show “Both approved these details” only when both approvals apply to the current revision. Do not imply a legal contract or independently verified understanding.
- Stale edits and approvals are rejected with a request to review the current version. Disconnected approval is disabled; queued approvals must never apply silently to a later revision.
- Read aloud and screen readers can present every field and current approval state. Sign playback uses only available reviewed phrase clips; missing coverage stays explicit.

### 3. Shared references, if the core passes

- Create a text reference such as “Form A — library membership application” or “Entrance B — beside the main road.” Include a human-written description.
- A message carries the reference ID and a label/description snapshot. Later renaming must not change the meaning of old messages.
- Keyboard, visible text, read aloud and screen readers expose the same description. Images, drawing boards and uploaded video are outside this first version.

## Early experiment before feature implementation

The largest uncertainty is whether selective repair/approval helps enough to justify the added interaction.

Use two consenting pairs and a paper or lightweight interactive prototype. Test three situations: an ambiguous entrance, a changed meeting time after one approval, and two similarly named forms. Compare against the existing ordinary chat with equivalent task sheets; alternate the order to reduce learning effects.

Record whether the final details are correct, time taken, clarification attempts and feedback. Ask each receiver to state the final details and compare against the task sheet. A click on “resolved” or “approved” is not the correctness measurement. Do not record video by default.

If neither pair benefits, revise the workflow before implementation. If confirmations are burdensome, restrict cards to explicit decisions and keep ordinary messages unchanged. User-test results cannot be invented when participants are unavailable.

## Thirty-day sequence

This assumes one student developer with coding support, the existing laptop, an Android device and access to consenting pilot participants. Start the day count when execution begins; dates depend on participant and relay access.

| Days | Work and owner | Exit evidence |
| --- | --- | --- |
| 1–4 | Student arranges participants and private account setup; coding work checks novelty comparisons, prototype and existing deployment readiness. | Two-pair findings, decided core scope, comparison matrix and deployment checklist. |
| 5–7 | Deploy the existing public build and complete physical laptop Wi-Fi ↔ Android mobile-data baseline, including relay. Fix blockers before adding workflows. | HTTPS invite works; 20 alternating messages match on both devices; audible two-way media and forced relay recorded as passed or failed. |
| 8–13 | Implement message-specific clarification, new linked corrections, authorization, action retries and output announcements. | Real two-device repair works; meaningful room/client/UI checks pass; original wording retained. |
| 14–18 | Implement one meeting template, revision checks, self-approval, reset-on-edit and reconnect snapshots. | Concurrent edits, stale approvals and reconnect tests pass; revised details require fresh review. |
| 19–21 | Integrate chosen input/output modes. Add text references only if the core is on time; otherwise use these days for fixes. | Draft/history retained during mode changes; missing sign/speech availability handled; references usable if included. |
| 22–26 | Run the larger pilot, actual NVDA/TalkBack tasks, permission-denial and network-interruption scenarios. | Results by pair, input/output and sign language; clear failures and corrective work. |
| 27–30 | Freeze features, fix important failures, repeat acceptance, prepare a live demo and evidence report. | Passing checks, reproducible demo, physical-device evidence and supported-feature/limitation documentation. |

Deployment and participant work can overlap prototype work. Reserve the final four days for fixes and presentation. If time slips, cut references and extra templates; retain clarification, one meeting template and the verification period.

## Implementation outline

- Extend `server/rooms.js` with validated, bounded room actions and snapshots for clarification and cards. Keep current immutable message IDs and server-assigned participant identities/order. Broadcast through the authenticated channel in `server/roomServer.js`.
- Extend `src/lib/roomClient.js` with stable action IDs, acknowledgements, immutable pending payloads and reconnect reconciliation. Retrying the same action must not create a second request, correction or approval.
- Use `baseRevision` for edits and the displayed `revision` for approvals. The server assigns accepted revisions and verifies membership; clients cannot choose the partner's approval identity.
- Extract optional message actions and a card component from `src/modes/ConnectMode.jsx`. Reuse its reviewed composer and device output preferences. Do not replace working WebRTC or recognition hooks.
- Add action/event IDs to the once-only output queue. The current UI announces new message IDs; card updates need separate event handling. Reconnect snapshots and preference changes must not replay old speech or screen-reader announcements.
- Bound workflow objects, retained revisions, event count and byte size. Reject an action whose referenced message/revision is unavailable with a clear status. End, expiry and server restart end shared workflow state too. No persistent cloud database or media upload is needed for this pilot.
- Keep transport labels such as “Received on partner's device” separate from explicit card approvals and resolved requests. AI remains optional and cannot publish, approve or resolve on a user's behalf.

## Quality gates — targets, not achieved results

| Area | Required evidence |
| --- | --- |
| Ordinary conversation | Zero added mandatory confirmation steps; history and drafts survive input/output preference changes. |
| Protocol correctness | No stale or forged approval accepted; no silent overwrite from concurrent edits; same-ID action retries deduplicate; corrections retain original messages. |
| Physical connection | Windows Chrome ↔ Android Chrome on different networks exchange 20 alternating messages without misses/duplicates; video/audio work in both directions; forced-relay test records an actual relay candidate. |
| Failure recovery | A network interruption preserves drafts and reconciles current server state; camera/mic denial leaves typing usable; room restart/expiry shows ended rather than recovered approvals. |
| Accessibility | Actual keyboard completion plus NVDA and TalkBack checks of clarification, correction, card editing, approval and revision. Announcements occur once and statuses use text as well as visual cues. Record the tested versions. |
| User outcomes | Aim for at least five consenting pairs, five baseline and five matched feature tasks per pair: 50 attempts total. Aim for at least 23 of 25 feature-condition tasks completed correctly and no incorrect final details marked approved in this sample. Report exact counts and pair-level results. |
| Added effort | At least three of five pairs prefer using the optional workflows for the tested tasks; report time and extra actions. If correct completion worsens or effort overwhelms the benefit, simplify rather than declare success. |
| Regression | Existing `npm run check` plus meaningful new protocol/client/UI checks pass; public build excludes research weights and secrets. Automated/mock results remain separate from physical and user tests. |

The pilot is small and cannot establish general effectiveness, statistical significance, unfamiliar-signer accuracy or universal accessibility. ISL and ASL results are separate; absent participants means that language's new validation is incomplete. Typing, live video and available outputs remain supported regardless of model availability.

## Infrastructure and dependencies

Keep the agreed ₹0 pilot infrastructure and require no Gemini request for the human workflows. Render account readiness is confirmed; private relay configuration is still pending. Do not put private keys in chat, source control or browser bundles.

[Render Free](https://render.com/docs/free) sleeps after 15 minutes without inbound traffic, can restart, and uses an ephemeral filesystem. Plan for startup and room-ended states; no durable room history is promised. Its included usage has limits, so review account spending controls and avoid paid upgrades. This is a pilot, not a production uptime claim.

[Metered Open Relay](https://www.metered.ca/tools/openrelay/) advertises 20 GB free TURN usage per month and requires a free account. Verify usage before the demo. If relay is unavailable, retain text and label cross-network video/forced relay as incomplete. No paid workaround is authorized by this plan.

Student responsibilities: private hosting/relay setup, Android and network access, consenting volunteers, and fluent reviewers for any sign-video content. Coding responsibilities: implementation, automated verification and fixes. Physical/accessibility/user test findings need evidence from the actual test, not an assumption.

## Month-end deliverables

1. A public pilot with optional clarification and one revision-safe meeting template.
2. A short live demonstration: send, clarify, correct, approve, change the time, reject an old approval, reconnect and approve the new revision.
3. A competitor/research comparison showing verified overlap, documented differences and unknowns.
4. A report containing baseline-versus-feature task results, actual-device/relay/accessibility observations, failures and exact supported modes.
5. A concise setup/runbook and a consented backup demonstration, clearly labeled as recorded if live connectivity fails.

Braille hardware, continuous sign translation, generated fluent ISL/ASL avatars, rich media reference boards and new recognition training remain later phases. The defensible contribution is: “We designed and evaluated a conversation workflow that helps people clarify messages and review shared decisions across their chosen communication modes.”
