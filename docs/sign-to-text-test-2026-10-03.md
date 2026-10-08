# Existing sign-to-text flow test — 3 October 2026

Requested scope: test the existing sign-to-text features, rather than implement continuous sentence translation. The main result is that capture/review/text delivery works under automated and server checks, while the existing models still have substantial recognition limits, especially ASL.

## Test matrix

| Area | Evidence | Result / limit |
| --- | --- | --- |
| Local model delivery | Actual HTTP requests to the running development server | ISL and ASL returned JSON/200, passed the real artifact validator, and exposed 49/100 labels. |
| Model loading/error/retry | Thirteen hook tests with mocked HTTP and the real numeric validator | ISL/ASL switching, late old responses, abort/unmount, unavailable/HTML/malformed/wrong-language/non-numeric or oversized artifacts, and retry recovery pass. |
| No visible hands | Actual served model weights through the app inference function | Both returned `no_sign` with empty meaning; no fallback word. |
| Landmark schema and preprocessing | Node regressions and real held-out raw-pose parity | Complete detected hand arrays are preserved; missing/partial/nonfinite hands remain missing. Body normalization, motion order and rejection gates pass. |
| Camera and tracking lifecycle | Mocked media/React tests | Permission denial, late acquisition, selected laptop camera, stream loss, task cancellation/failure/retry and paused/repeated frames pass. This is not a fresh camera test. |
| Framing and readiness | Room recognition component tests | Idle hand/shoulder feedback does not infer words; stale frames disable new capture and expose retry. |
| Complete capture | Room/workspace component tests | Prediction waits for Finish; Cancel/camera loss/tracking error discard partial turns. Twelve-second completion, 100-sample bound and ordered timestamps pass. |
| Review and draft | Component/integration tests | Tentative candidates require explicit review/selection; a correction can be added without sending. Typed text keeps Typed provenance; captured ISL/ASL metadata survives preference changes and retries. |
| Full draft | New regression and fix | When adding a word would exceed 2,000 characters, the draft and corrected reviewed word remain intact. Shortening the draft allows retry without recapture. |
| Personal signs and shortcuts | Existing classifier/smoother/SignMode tests | Saved personal signs, hold/repeat behavior and optional gesture mappings pass. Unknown open palm does not produce default HELLO. Gesture shortcuts are separate from ISL/ASL language models. |
| Model inference accuracy | Fresh evaluation of every prepared held-out example | All 149 selected labels were represented across 847 examples. Numerical inference agrees; recognition accuracy/acceptance remains limited (table below). |
| Text delivery after review | Actual standalone HTTP/WebSocket test in a disposable room | Twenty alternating constructed ISL/ASL reviewed texts, twenty same-ID retries, two corrections and authenticated reconnect passed with matching histories and no duplicate broadcasts. |
| Optional AI video interpretation | Existing validation/consent/cancellation tests with mocked provider responses | Application handling is covered; no real camera clip/provider interpretation or accuracy measurement was performed. |
| Live physical signing | Not performed in this run | Browser inspection of the localhost tab was previously blocked by browser security policy. No alternate browser/indirect browser-command workaround was used. |

## Recognition results

These results use actual saved dataset poses, not synthetic successful word predictions. Top-1 means the highest scoring known word **before** rejection; accepted results use the existing confidence/margin thresholds. No training, new recordings or threshold changes were made.

| Held-out dataset result | ISL | ASL |
| --- | ---: | ---: |
| Supported labels / known recordings | 49 / 192 | 100 / 255 |
| Top-1 accuracy before rejection | 75.00% | 40.78% |
| Accepted correct / accepted wrong / rejected | 90 / 3 / 99 | 22 / 5 / 228 |
| Labels with at least one correctly accepted example | 42 / 49 | 16 / 100 |
| Unknown recordings incorrectly accepted | 27 / 200 (13.50%) | 9 / 200 (4.50%) |

HELLO is not the only output. Correct accepted ISL examples include BANK, BIRD, CAR, GOOD MORNING and THANK YOU. Nevertheless, seven ISL and 84 ASL classes had no correctly accepted example in this small test set. Neither dataset result establishes unfamiliar-signer or spontaneous laptop-signing accuracy.

See the [full hashed evaluation](model-evaluation-2026-10-03/README.md), [149-word results](model-evaluation-2026-10-03/known-words.csv) and [reviewed-text transport evidence](reviewed-sign-transport-2026-10-03.md).

## Final verification

After the overflow fix and all new regressions, `npm run check` passed: **190 Node tests + 194 UI tests in 20 files = 384 passing application checks**, zero failures, followed by the production/PWA build. The separate Python training/data suite passed **42/42 tests**. Numerical parity passed for both language artifacts and for all 847 held-out feature sequences; these samples are not counted as additional UI tests.

`npm run build:public` passed last. The final `dist` has no models directory. Both local development model artifacts remain unchanged and available at the development origin. The running website and room proxy returned HTTP 200 after the final build; servers were not restarted during this test.

## Fix found during testing

RoomSignCapture previously cleared its reviewed meaning even when the parent rejected an oversized draft addition. ConnectMode now returns whether the addition succeeded; the capture review clears only after success and shows recovery guidance after a rejection. The fix keeps the completed capture/review and existing draft available for retry. Four new flow regressions cover the parent rejection/retry contract, retained child review, dense capture bounds and recovery after a prediction exception. Thirteen further tests cover model loading boundaries and cancellation/retry races.

## Remaining live checks

On the actual laptop, choose one supported word in the selected language and perform it completely after Capture. Record correct, incorrect and rejected predictions separately. Repeat with ASL/ISL, poor framing, unfamiliar signs, interrupted movements, camera disconnection, language changes, corrected review and a nearly full draft. A fluent signer should independently verify the intended word.

An already active turn can finish from earlier samples after tracking pauses; capture diagnostics warn about the gap. The current implementation does not reject solely because of that gap. This behavior needs a real interrupted-sign trial.

Camera footage and pose samples were not recorded/exported by this test. The disposable transport test did not invoke AI; it made zero `/api/chat` requests. The user's separate room was not joined/ended, and the running website/room processes were preserved.
