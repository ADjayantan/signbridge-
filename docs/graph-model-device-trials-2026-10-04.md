# Sign recognition device trials — 4 October 2026

Status: **not run**. Automated tests and Node ONNX/WASM fixtures are recorded separately in the [implementation report](graph-model-implementation-2026-10-04.md). No trained candidate is promoted. The new 75-joint option is expected to show unavailable until all release gates and an actual device report pass.

Use Windows Chrome first and Android Chrome second. Record browser/device versions, model ID/hash, sign language, input/output preferences and actual outcome. Choose ISL or ASL explicitly; their signs and trained vocabularies differ. Use the existing experimental model for engineering trials only. Do not label self-imitation or arbitrary hand movements as correctly recognized sign language. Known-sign accuracy needs a fluent reviewer and supported reference meanings.

| Trial | Action | Expected engineering result | Status |
| --- | --- | --- | --- |
| Camera and hand tracking | Enable local recognition, allow camera, show both hands and shoulders, then move out of view | Joint overlay follows measurements; missing landmarks do not become invented signs | Not run |
| Camera denied | Deny camera access in a fresh session | Clear device error; typing, drafts and conversation remain usable | Not run |
| Complete reviewed turn | Capture a supported reference word, Finish, inspect/edit the result | A tentative result or rejection appears; no automatic Send or speech | Not run; fluent review needed for correctness |
| Reviewed text to voice | Edit the recognized draft, then explicitly Read aloud | Audible output matches reviewed text and language; dictation does not capture playback | Not run |
| Text to partner | Explicitly Send one reviewed message | Partner receives one ordered message with the reviewed text and source metadata | Not run; two devices required |
| Low quality / nonsigning | Try occlusion, hands outside view, ordinary movement and idle turns | Quality failures request recapture; record every accepted error, rejection and exclusion | Not run; not a quantified idle false-positive rate |
| Long dropout | Pause tracking beyond the declared timestamp-gap bound | New 75-joint runtime returns a recapture request without interpolating through the gap | Pending a promoted candidate |
| Candidate availability | Select Evaluated 75-joint model with no promoted artifact | Clear unavailable state; existing reviewed draft survives | Not run |
| Cancel and changes | Repeat 20 capture/cancel/language/model-change cycles, including a change while inference is pending | No late recognized word, speech or Send; no stale-language result | Not run |
| Camera lifecycle | Leave/End the room during capture; restart deliberately | Room-owned tracks stop on Leave/End; local recognition does not separately acquire/retain a camera | Not run |
| Worker/artifact failure | Exercise a controlled missing/corrupt artifact in a local research build | Availability/error state and bounded retry; typing remains usable | Pending a promoted test artifact |
| Network interruption | Disconnect and reconnect while a draft exists | Draft/history survive an active room reconnect; no duplicate message or stale media | Not run; two devices required |
| Device timing | Measure 50 warm Finish-to-result runs, cold load separately, actual pose gaps and responsiveness | Report median/p95 and exclusions; target warm p95 <= 1 second; do not substitute classifier-only timing | Pending a promoted candidate |
| Output/accessibility | Change input/output preferences mid-conversation; use keyboard and screen reader | History retained, visible reviewed captions, one appropriate received-message announcement | Not run |
| Public/PWA update | Install/update public build from an earlier research-cached installation | Research model requests stay unavailable; no cached weights used by public hooks | Not run |

For each known sign, retain aggregate attempts, correct tentative results, accepted mistakes, rejections, capture-quality exclusions and corrected text. Report end-to-end correct coverage using all attempts as the denominator. Record unfamiliar signers separately. Do not pool repeated predictions or seeds as independent participants, infer sentence translation from isolated glosses, or upload/save footage without an explicitly consented collection study.

Current decision: engineering implementation and historical benchmark are complete; live-device and linguistic release evidence is pending. Continuous automatic sentence translation remains outside this limited-word experiment.
