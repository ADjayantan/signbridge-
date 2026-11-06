# Sign-only sender to text and voice: verification, 9 October 2026

The requested acceptance test is a person signing through the camera and their partner receiving the meaning as visible text and voice. **This complete test has not passed on the public pilot.** The deployed app has no available word-recognition weights. Message delivery and output were tested separately so they are not mistaken for recognition accuracy.

## Results

| Stage | Result | Evidence and scope |
| --- | --- | --- |
| Real camera sign to recognized meaning | Blocked on the public build | The sign capture panel reports local research weights unavailable. No Capture a word button is available. Camera and microphone remained off; real signing was not tested. |
| Synthetic pose to reviewed sign message | Passed engineering checks | Two integration cases use ASL/ISL metadata and a deliberately biased HELLO model fixture. They run capture validation, preprocessing, inference and reviewed composition, not real recognition evaluation. |
| Reviewed sign message to partner text | Passed | Integration cases use actual HTTP room membership and WebSocket clients. A separate controlled sign-result fixture reached a receiver on the deployed HTTPS/WSS service as HELLO with Reviewed sign / ISL metadata. |
| Partner voice request | Passed engineering checks | Integration cases assert one mocked speech request; sender speech stays off and receipts do not repeat playback. |
| Native browser playback completion | Observed | The deployed receiver displayed Read-aloud playback ended for the controlled sign-result fixture. This browser callback does not prove speaker sound was audible. |
| Audible speaker output | Unverified | The user said they had not tested/listened. No audible pass is claimed. |
| Same-ID retry | Passed | The deployed server acknowledged a retry and the receiver retained one message. |
| Empty sign capture | Passed | The integration case rejects an empty capture without sending or speaking. |

## Automated coverage

`tests/ui/reviewedSignConversation.test.jsx` adds three integration cases. It uses real ConnectMode, RoomSignCapture, GRU preprocessing/inference, RoomClient and a loopback Node room server. Synthetic camera landmarks, model loading, media and speaker hardware are fixtures; an empty saved-video library is also supplied. The model intentionally forces HELLO so these cases test orchestration and language metadata, not whether either sign language was learned correctly.

The successful cases follow **Capture a word → synthetic pose frames → Finish sign → review HELLO → Add reviewed word → explicit Send**. They do not type HELLO into the draft as a replacement for sign input. The partner receives visible text and one speech request, without AI/provider requests. Each logical participant has separate room-client storage. An independent source review found no material test issue.

`npm run check` completed successfully: **282 Node tests + 360 UI tests = 642 tests**, with 31 UI suites and the regular production build. This run is not a real-camera, physical-device or speech-hardware test.

## Public pilot check

The public origin was `https://signbridge-conversations.onrender.com`. `/models/isl.json`, `/models/asl.json` and `/models/graph-manifest.json` each returned 404. This agrees with the public build's deliberate exclusion of local research artifacts and its recognition availability guards. Tracking hand joints alone cannot supply a word's meaning.

A disposable sender used the real RoomClient with a controlled reviewed-sign result, `{ text: 'HELLO', inputMethod: 'sign', signLanguage: 'isl', lang: 'en' }`. A real browser participant received it, showed the text and sign metadata, and reported native read-aloud completion. Resending the same message ID produced an ACK without a second message. **This fixture bypasses real recognition and is not a sign-to-voice accuracy demonstration.**

During continued inspection both earlier disposable browser rooms changed to Room ended; no cause was established, so this is not described as a successful long-duration or reconnect test. The service health endpoint subsequently returned `{ ok: true }`. A fresh room reproduced the missing-model notice, and was explicitly ended after evidence collection. The sender probe was ended/disposed and stopped; test browser tabs were closed. Private screenshots and temporary probe code stay in ignored local logs.

## What is needed before the full test can pass

Release an appropriately licensed and evaluated limited-vocabulary model through an explicit public-artifact path, with a declared vocabulary and unknown-input rejection. Validate actual webcam recordings and held-out signers before promoting it. Then repeat the entire camera → reviewed meaning → partner text → audible voice test on two actual devices. Shipping the laptop's unvalidated research weights or forcing HELLO would not resolve this acceptance gate.

Only test and evidence files were added in this follow-up. The running app source remains `e5513e2`; no new model was trained, promoted or deployed.
