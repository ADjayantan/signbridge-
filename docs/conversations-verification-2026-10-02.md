# Conversation software verification — 2 October 2026

The software for the accepted four-phase plan is implemented locally. Deployment and physical Windows/Android acceptance remain pending. The Render account is ready; Metered configuration has not been supplied. No paid service was created and no new sign-recognition accuracy is claimed.

## Implemented scope

| Phase | Delivered |
| --- | --- |
| Connect people | People-first Home, `/#connect`, two-person private invites, authenticated WebSocket messages, ordered history, receipts, device preferences and reconnect identity. |
| Live sign and voice | WebRTC send/receive audio/video, laptop camera preview, separate opt-in camera/mic controls, shared recognition stream, negotiation/reconnect and optional TURN/forced-relay controls. |
| Input and output | Reviewed dictation and isolated-word sign capture, editable drafts, explicit Send, received-message read aloud, screen-reader announcements and available saved phrase videos. Optional AI remains a separate explicit action. |
| Reliability/accessibility | Draft recovery, stable-ID retries, media cancellation/cleanup, availability/errors, mobile layout, labelled keyboard controls, announcement deduplication, public model exclusion and repeatable deployment/device-test instructions. |

Research models and saved browser libraries were preserved. Braille hardware, new training, continuous translation and fluent ISL/ASL sentence generation remain later work.

## Automated checks

Final `npm run check` passed:

- **162 Node tests**, including real local HTTP/WebSocket rooms, 20 alternating messages, authentication/invites, third-member rejection, expiry/restart, deduplication/history limits, resume receipts, signaling isolation and Metered fallback.
- **139 UI tests across 17 files**, including reviewed inputs, preference/history retention, uncertain-send retries, stale AI/dictation cancellation, one shared camera, media cleanup, offline recovery, ordered read-aloud turns, echo prevention and screen-reader announcement updates.
- Local production build and PWA generation.

`npm run build:public` also passed. The generated directory has the app, manifest, worker and icons; **no `dist/models` directory**. Standalone HTTP smoke checks returned 200 for `/`, `/api/health`, the manifest and icon; ISL/ASL weight URLs returned 404. Standalone optional-AI status reports room authentication is required. No private key values were inspected or included in this report.

The public build was produced last, so the current `dist` is suitable for the public pilot. Running ordinary `npm run build` again restores a local build; use `build:public` for deployment.

## Actual browser checks on this laptop

These used two independent **Chrome tabs on one Windows laptop**, first through the Vite proxy at port 5173 and then through the built standalone app at port 3001. They are not two physical devices or different networks.

| Check | Observation |
| --- | --- |
| Create and join | Host created an invite; an independent tab joined as the second participant. Both showed Room connected. |
| 20 alternating messages | Both tabs displayed exactly the same 20 ordered messages, without missing/duplicate entries. Server ACK cleared the sent draft and device receipts appeared. |
| Direct local WebRTC | Video link connected without Gemini or a recognition model. The laptop preview and the partner's received video both decoded at **640×480**, readyState 4, playing. This verifies laptop-to-partner video on this machine; audible audio was not verified. |
| Preference changes | Changing Type to Sign, Text to Screen reader, and ISL to ASL retained the 20-message history and the unsent draft. Defaults were restored afterwards. |
| Offline/online recovery | Chrome DevTools simulated a network interruption. Send immediately became disabled, the draft and 20 messages stayed present, and reconnect resumed automatically after networking was restored. This was browser emulation, not a physical router/mobile-network failure. |
| Mobile breakpoint | At an actual emulated viewport width of 390 pixels, document width was also 390; layout stacked without horizontal overflow. This does not establish Android hardware/browser usability. |
| Keyboard | Input radios accepted arrow-key navigation and retained keyboard focus. Full keyboard-task, NVDA and TalkBack acceptance remain pending. |
| End for both | Both tabs showed Room ended; both video elements were removed. Camera off was checked before ending. Track-stop and pending-permission cleanup are covered by simulated-media tests. |
| Public build | Room creation/join and bidirectional text worked from the built app. Requiring relay without credentials produced a clear unavailable message; partner text still arrived. Enabling local recognition showed that research weights were unavailable, rather than guessing a sign. |

Browser testing found and fixed a native `fetch` receiver error in room creation. It also led to immediate offline suspension, suppression of stale partner-offline signaling alerts, correct recipient-receipt labels, and explicit echo prevention for read aloud/dictation. Reloading during active development resets media; the final video check used fresh page loads after all calling-code edits.

Test rooms were ended and temporary partner/public-test tabs closed. Browser network and viewport overrides were restored. The app is left ready at `http://127.0.0.1:5173/#connect`, with typing/text defaults and devices off. Development servers use ports 5173 and 3001.

*Archived test capture omitted from this public source snapshot.*

*Archived test capture omitted from this public source snapshot.*

## Remaining acceptance

Follow [deployment and physical-device acceptance](conversations-deployment.md) for Render Free setup, private Metered environment variables, laptop Wi-Fi ↔ Android mobile-data calls, a forced TURN candidate check, real microphone transcription/audio, assistive-technology use and signer review. The free hosting service has not been deployed by this implementation. Existing model metrics describe the earlier dataset evaluations, not these conversation tests.
