# SignBridge: shared pilot and parallel development

8 October 2026 — implementation plan, not a claim of completed deployment or reliable translation.

The goal is two-way communication: a signer sends a reviewed meaning that a partner can read or hear; the partner speaks or types a reply that the signer can understand through text or an available verified sign video. Each person chooses their input and output. Limited reading fluency needs its own design support, without sorting people into disability categories.

## Stage 1 — Put the conversation on a shared HTTPS server

Push the reviewed application source to GitHub, then connect that repository to a Render Free Node web service. The existing configuration uses `npm ci && npm run build:public`, `npm start`, and `/api/health`. GitHub stores the code; Render runs the room server and website. GitHub Pages alone cannot run this WebSocket backend.

Keep secrets, personal recordings and research artifacts out of the push. Public builds exclude laptop research weights. Saved sign videos currently live separately in each browser; deployment does not transfer them to another device. Begin with a text/video pilot that needs no AI key. Add private TURN settings when relay access is ready; neither a working Render service nor relay configuration is established yet.

**Gate:** two actual devices on different networks exchange twenty alternating messages without loss or duplication. Verify denied camera/microphone, invalid invite, third participant, room expiry, draft recovery and server restart. Test video/audio directly and with forced relay separately. Retain text if media fails. Record real-device results separately from automated checks; two tabs on one laptop are insufficient evidence.

## Stage 2 — Prove a small, understandable two-way flow

Make the conversation the obvious entry point. Put Training Studio and model diagnostics under Tools. Add short visual instructions, simple Tamil/English interface choices, large primary actions and visible status/error recovery. Changing speech language alone currently does not translate the interface.

Choose a small essential phrase list with fluent review, consented reference recordings and explicit ISL/ASL labels. Those languages require separate coverage. Provide visual demonstrations and a meaning confirmation step for supported signs. A tracking overlay shows where joints are found; it is not evidence that a meaning was understood.

For replies, resolve reviewed speech/text to an exact verified phrase video when one exists. Show the actual coverage and let users request clarification. Arbitrary text cannot be guaranteed a sign translation. Word clips in text order do not establish sign-language grammar. Keep per-message replay and help available without unexpectedly leaving the room. Never auto-send uncertain predictions; AI assistance stays an explicit action, separate from human delivery.

**Gate:** a fluent signer and a participant unfamiliar with signing complete the agreed phrase exchanges in both directions. A participant with limited reading fluency can find the conversation, capture, confirm, send, replay and recover with the visual guidance. Until those participants and recordings are available, report only a simulated walkthrough. Both receiving devices must actually have access to the verified video assets.

## Stage 3 — Improve recognition with honest evidence

The twelve-word ASL validation pilot failed every frozen release gate; BOOK/DRINK user failures remain unresolved. No variant was promoted. Start by improving capture quality and collecting consented, correctly labelled temporal landmarks, including nonsigning movements and unsupported signs.

Freeze vocabulary, feature order, timing, normalization, signer groups, evaluation metrics and promotion thresholds before experiments. Separate signers between training, validation and a fresh final test. Compare temporal baselines and graph models under the same protocol. Report accepted-known precision, correct-known coverage, false acceptance of unknown/nonsigning input, per-word failures and measured device latency. High accuracy after rejecting almost everything is not useful communication.

The external LSTM repository is a useful example of learning from ordered landmark frames, rather than thousands of raw images. Its original notebooks have conflicting three-label lists without a bundled label manifest; its weights and feature representation do not match SignBridge. It is not a graph model or a ready conversational translator. See the [full source assessment](external-lstm-full-analysis-2026-10-08.md). Any later source reuse must retain the applicable MIT notice.

**Gate:** the candidate passes the frozen signer-independent thresholds, browser/export parity checks and supervised live trials. State uncertainty and sample size. No threshold retuning on the final test, automatic promotion or public release after a validation improvement alone.

## Two development agents, with explicit ownership

| Owner | Work and files |
| --- | --- |
| Local recognition agent | `training/`, recognition libraries/hooks/worker, corresponding model tests and evaluation reports. Private consented data and weights remain on the laptop. |
| Cloud conversation agent | Home/Connect conversation UI, room workflow, sign-video player/library, conversation styles and their UI tests. Use source and synthetic fixtures only. |
| Integration owner | Shared contracts, dependency files, camera/media hooks, capture component, room backend, deployment and merging. Assign any shared-file change to one agent before work begins. |

Each agent works on a separate `codex/` branch and submits a reviewable change. No simultaneous edits to the same files. The shared contract distinguishes capture readiness, tentative recognition, rejection reason, reviewed text, language, input source and stable message identity. Reviewed text alone may enter human message delivery; private landmark samples never enter the room protocol.

Integrate one change at a time: check contract fixtures, meaningful affected tests, `npm run check`, public build exclusions and the two-device checklist. Cloud work cannot run private training or assume clips/weights are deployed. Expand vocabulary and conversation automation only after these gates pass; continuous sentence translation remains a later research milestone.
