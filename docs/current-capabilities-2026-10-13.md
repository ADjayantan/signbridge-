# SignBridge — current capabilities, 13 October 2026

SignBridge helps two people choose how they send and receive a message, without putting people into disability categories. Its conversation software is implemented. Reliable automatic sign-language understanding remains the main unfinished component.

| Capability | Current behavior | Verification or limitation |
|---|---|---|
| Two-person conversations | Create an invite, join a room, send reviewed text, see connection/delivery state and resume after interruption. | Local and remote HTTPS/WebSocket protocol checks passed previously. Physical two-device acceptance is still pending. |
| Speech input | Browser dictation creates an editable transcript; the person reviews and sends it. | Availability depends on the browser. A transcript is not silently sent to AI. |
| Voice output | Read aloud a reviewed message or a received message, with visible playback/error controls. | Playback completion is different from a person confirming audible sound. |
| Live sign video | Share camera video directly with a partner; camera/microphone controls are optional. | Video transmission itself does not translate signs. Cross-network/forced-relay physical-device tests remain pending. |
| Camera landmarks | Track body and up to 21 joints on each hand, with framing/visibility guidance. | Seeing joints is not evidence of understanding a word. |
| Sign to text and voice | Attempt isolated-word recognition, show the result for review and optionally speak an accepted word. Automatic moving/still-pose capture is implemented. | Active local vocabulary: 49 ISL and 100 ASL words. User webcam recognitions remain unreliable; universal or sentence translation is not implemented. |
| Replies in signs | Play matching videos from that device's saved phrase library. | Requires an available matching clip. There is no general fluent signing avatar or automatic sign-video generation. |
| Optional AI assistant | Send reviewed text for an AI reply; separate voice and experimental video-practice tools exist. | Requires server-side Gemini configuration. AI responses do not establish accurate recognition of the original sign. |
| Training Studio | Consent to store labelled pose sequences locally, review the inventory, export examples and record explicit no-sign examples. | Saving examples does not retrain or replace the model. Exported examples need a separate, evaluated training run. |
| Accessibility | Keyboard controls, visible text, screen-reader announcements, editable drafts and communication preferences. | Real participant usability and assistive-technology trials remain separate from automated UI checks. |

The intended complete flow is: **a person signs → the system understands the sign → their partner receives readable text and optional voice**. The return direction is **speech or typed text → readable text and available matching sign videos**. The first direction's recognition reliability and the return direction's broad sign-video coverage are not complete.

The 11 October research candidate improved historical archived-pose top-one accuracy from 75.00% to 93.23%, but falsely accepted 18% of unsupported-word test recordings and rejected the selected raw HELLO test video. It was not installed into the app. The active laptop model remains unchanged. See [the measured training report](C:/Users/adjay/Downloads/signbridge/docs/camera-training-results-2026-10-11.md).

A further current-detector study is complete: 60 official videos were downloaded and measured through the app's current browser detector, and two separate candidates were trained and evaluated. The second candidate correctly accepted one of two HELLO test recordings, but correctly accepted only two of eight supported-word test recordings and falsely accepted two of six unsupported-word recordings. Both candidates failed the frozen requirements and were not installed. These are recorded-video results, not a successful test on the user's webcam. See [the measured results](C:/Users/adjay/Downloads/signbridge/docs/tasks-video-training-results-2026-10-13.md) and [scalar evidence](C:/Users/adjay/Downloads/signbridge/docs/tasks-video-training-metrics-2026-10-13.json). Braille hardware, continuous sentence translation and reliable recognition of every sign are later work.

Local development servers were restarted and became ready on 13 October: web on port 5174 and room server on port 3001. The previously deployed Render pilot is separate from the laptop's local research models; public builds exclude those weights.
