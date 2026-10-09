# Reviewed sign-text transport check — 3 October 2026

The running standalone room server at `http://127.0.0.1:3001` passed a targeted HTTP/WebSocket integration check. A Node CLI process used the app's exported `RoomClient` and real `ws` connections to create and join its own disposable two-person room. No browser automation was used, and the user's separate room, camera and servers were left running.

## Observed results

| Check | Result |
| --- | --- |
| Reviewed messages in both directions | 20 alternating messages were received: 10 host-to-guest turns marked ISL and 10 guest-to-host turns marked ASL. |
| Input and language metadata | Both histories retained `inputMethod: sign`, the intended lowercase `signLanguage: isl/asl`, `lang: en`, reviewed text and the server-assigned sender. The client normalized uppercase input language values before sending. |
| Reviewed corrections | Two new sender-owned correction messages linked to their originals. The original WATER and HELLO wording stayed unchanged. The corrections retained their sign-source metadata. |
| Delivery and order | Both participants had the same 20 unique message IDs and canonical contents, with server sequence numbers 1 through 20. |
| Duplicate retries | All 20 messages were retransmitted as raw WebSocket frames with their original IDs and payloads. Every retry received a new server ACK; neither participant received a duplicate message broadcast. |
| Reconnect history | Reconnecting the guest restored the same participant identity and exact canonical history, including correction links and language metadata. |
| Optional AI isolation | This test made two room HTTP requests, for creation and joining, and zero `/api/chat` requests. It did not invoke optional AI help. |
| Cleanup | End for both was sent only in the test-owned room; the test guest observed Room ended. Both test clients were disposed. No room IDs, invite tokens or participant credentials were printed or saved in this report. |

## Scope

The submitted text was constructed as already reviewed sign-derived text. This proves delivery and metadata handling after review. It does not establish that a human hand movement was detected or that the ISL/ASL model predicted these words correctly.

No camera acquisition, live known-word trial, spoken transcription, sign-video output or different-network video/relay trial was performed in this check. Actual live recognition and physical-device outcomes must be recorded separately. The existing isolated-word model accuracy evidence remains unchanged; no training was performed.

No functional transport defect was found and no source or automated regression test was changed for this targeted run. The root verification run records the full automated test/build results separately.
