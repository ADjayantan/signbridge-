# Partner playback recovery and connection route

8 October 2026 — bounded video-call improvements; private TURN setup and physical-device media testing remain pending.

## Recover blocked partner playback

The previous autoplay failure message told the user to tap the partner video, but the video had no playback action. The conversation now shows **Play partner video/audio** when the browser rejects playback. This is a normal keyboard-accessible button; its click calls playback immediately, preserving browser user activation.

Retry keeps the current partner stream and camera state. It does not send a message, open another camera, restart the peer or replace the relay notice. A result from an old playback attempt cannot clear a newer error or restore an alert after the stream ends/reconnects.

## Check the selected connection route

In an active conversation:

1. Open **Video connection options**.
2. Once the media connection is connected, choose **Check video route**.
3. Read **relay**, **direct**, **mixed**, or **not available yet**. Missing statistics stay unknown rather than guessing from configured relay servers.

The check follows each transport's `selectedCandidatePairId`, requires a successful selected pair and known local/remote candidate types, and returns only a route label. A successful or nominated but unselected pair is not proof that relay is used. Multiple transports with different routes are reported as mixed. Incomplete data remains unknown. See the [WebRTC statistics specification](https://www.w3.org/TR/webrtc-stats/#dom-rtctransportstats-selectedcandidatepairid).

No addresses, ports, candidate identifiers, credentials or raw statistics are shown or added to messages. Results clear on reconnect/disconnection. Late results from replaced peers are ignored. Checking a route does not prove that camera frames/audio are being received, the video quality is usable, or sign recognition is accurate.

For forced-relay acceptance, both actual devices should enable **Require video relay**, reconnect, and independently confirm relay use. Still test live video/audio in both directions; route status alone is insufficient.

## Private account step

The live server currently reports relay unavailable. The [free Open Relay account](https://www.metered.ca/tools/openrelay/) provides the application domain and TURN REST API key needed by the existing backend. The Metered browser tab is at sign-in. The user must complete their private login/signup; passwords and API keys should not be pasted into chat.

The private Render service environment needs `METERED_DOMAIN` and `METERED_TURN_API_KEY`. These are server settings, never `VITE_*` values. Keep the current Free compute plan and do not create a second service. The server already authenticates ICE requests and keeps the master key out of browser responses. Account setup/configuration is separate from proving an actual different-network call.

The existing [physical-device runbook](conversations-deployment.md#physical-two-device-acceptance) remains the acceptance checklist.

## Engineering verification

Seven selected-route fixtures cover relay/direct/mixed paths, unselected nominated decoys, incomplete references and disconnected states. Focused hook/UI tests cover blocked playback followed by explicit retry, stale playback/stats results, unavailable statistics, visible action binding and room/camera independence.

`npm run check` passed **282 Node + 328 UI checks (610 total)** and the regular build. `npm run build:public` passed separately and excluded research weights. These fixture-based checks establish software behavior; they do not establish real camera playback or different-network relay success.
