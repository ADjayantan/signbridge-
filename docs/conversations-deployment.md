# Conversation pilot: deployment and physical-device acceptance

**Status, 8 October 2026:** public pilot source pushed to [`codex/render-pilot`](https://github.com/ADjayantan/signbridge-/tree/codex/render-pilot) and deployed as `signbridge-conversations` on Render Free. [Open the live app](https://signbridge-conversations.onrender.com/#connect). Thirteen remote synthetic HTTPS/WSS checks passed, including twenty alternating messages, receipts, duplicate prevention and reconnect history; the browser also created, sent and ended a disposable room. See [deployment verification](render-pilot-verification-2026-10-08.md). The relay endpoint reports unavailable. Private Metered setup and physical Windows Chrome ↔ Android Chrome tests remain pending. Automated sockets and simulated media checks do not establish cross-network video success, fluent sign translation or assistive-device usability. The clarification, meeting and reference workflows have [separate local verification](conversation-quality-verification-2026-10-03.md).

## Local start and public-build check

Use Node 22.12+ in the repository directory. Preserve an existing `.env.local`; copy `.env.example` only when no private configuration exists. Human conversation works with `GEMINI_API_KEY` empty.

```powershell
npm install
npm run rooms
```

In a second terminal run `npm run dev`, then open `http://localhost:5173/#connect`. Vite proxies room APIs and `/ws` to port 3001. `npm run rooms` loads `.env.local`; keep `PORT=3001` for this workflow. A second browser/private window provides an independent participant. A copied tab can inherit credentials and replace the first session.

On this laptop, another project currently owns port 5173. The current SignBridge development session uses `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` and `http://127.0.0.1:5174/#connect`. Keep the room server on port 3001; there is no need to stop the other project.

Run `npm run check`, then `npm run build:public`. Keep/start `npm run rooms` and open `http://localhost:3001/#connect` to test the public build. `/api/health` should return `{ "ok": true }`; `/models/isl.json` and `/models/asl.json` must return 404. Public builds exclude research weights, and the server refuses those URLs even after a normal local build. Natural signing still works without weights. `npm run preview` does not supply the room backend.

## Free Render deployment

`render.yaml` is the deployment blueprint. The public service is running on Free compute; no database, disk or paid resource was created. The following settings reproduce the pilot:

The [Deploy to Render shortcut](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FADjayantan%2Fsignbridge-%2Ftree%2Fcodex%2Frender-pilot) selects the published pilot branch. The existing account already has the deployed service; do not create a duplicate for routine updates. The shortcut follows Render's [official button/branch documentation](https://render.com/docs/deploy-to-render). If reproducing the service in another account, explicitly select branch `codex/render-pilot` and Free compute.

1. In the existing Render account, create a **Node Web Service** from the repository, or use its Blueprint. Confirm **Free** compute before creating it. This pilot needs no database or persistent disk.
2. Set build command `npm ci --include=dev && npm run build:public`, start command `npm start`, and health check `/api/health`. The blueprint sets `NODE_ENV=production`; explicitly including development dependencies makes Vite available during the build. The server binds `0.0.0.0` and uses Render's supplied `PORT`.
3. Set private Metered values through the dashboard when available. Leave `GEMINI_API_KEY` unset unless room AI help is wanted. Metered is optional for deployment: text can run before relay configuration. Never commit/screenshot secrets.
4. Leave `VITE_ROOM_SERVER_URL` unset for same-origin hosting. Use `ROOM_ALLOWED_ORIGINS` only for additional frontends. If setting optional Gemini `ALLOWED_ORIGINS`, include the frontend making the AI request.
5. Open the deployed HTTPS `/#connect` page and check `/api/health`, then complete physical-device acceptance below.

The blueprint sets `autoDeployTrigger: off`, as recommended for a Deploy to Render button. Ordinary source updates need a deliberate deploy of the selected branch from the dashboard. Blueprint configuration syncs can still trigger deployment when configuration changes; expect existing in-memory rooms to end during either kind of deployment.

Render supports public WebSockets on the HTTP service; deployed clients use HTTPS/WSS. Free services can sleep after 15 minutes without inbound traffic, take approximately a minute to wake, and restart. Room state is in memory, so sleep/restart ends old rooms. The UI retains drafts and explains wake-up/reconnection; create a fresh room after “Room ended.” Free usage caps apply: check dashboard usage and retain the Free plan. [Render deployment](https://render.com/docs/deploy-node-express-app), [WebSockets](https://render.com/docs/websocket), [Free limits](https://render.com/docs/free).

Use one server instance. Durable transcripts and shared state across instances are future work.

### Private Metered configuration

1. Use a **free Open Relay** account and obtain its application domain and **TURN REST API key**. The application uses its own signaling server; a Metered publishable signaling/SDK key is not used.
2. Privately set server environment variables `METERED_DOMAIN=your-app.metered.live` and `METERED_TURN_API_KEY`. Locally put them in `.env.local` and restart `npm run rooms`. On Render, restart/deploy the existing service after saving values; its backend reads them at startup. Existing rooms end, so create a fresh invite. Neither secret belongs in `VITE_*`.
3. Authenticated room members fetch ICE configuration from the room server. It caches successful upstream results for five minutes and failures for 30 seconds. Temporary ICE credentials reach the browser peer; the master API key and raw upstream errors do not.
4. Confirm allowance/usage in the account dashboard. Open Relay currently advertises 20 GB/month free TURN traffic. This app does not inspect remaining allowance or purchase capacity. Failed/missing relay configuration leaves text available and explains video availability. [Open Relay setup and allowance](https://www.metered.ca/tools/openrelay/).

### Existing Vercel tools

`api/chat.js` and `vercel.json` host the older AI function/static app separately. They do not run the persistent room WebSocket server. A separate frontend needs `npm run build:public`, build-time `VITE_ROOM_SERVER_URL` pointing to the Render HTTPS origin, and that frontend origin in Render's `ROOM_ALLOWED_ORIGINS`.

Room **Optional AI help** uses authenticated `POST /api/chat`. Standalone AI status adds `roomAuthRequired: true`, while preserving configured-key readiness. Older AI tools lack room-member headers; they cannot call this protected endpoint directly. Local Vite/Vercel tools have a separate AI route and retain their existing behavior. Local recognition, speech, saved videos and Training Studio do not need AI. Vercel's old AI route does not inherit standalone room authentication/rate limits.

## Physical two-device acceptance

Use **two actual devices**: Windows Chrome on Wi-Fi and Android Chrome on mobile data, both on deployed HTTPS. Record date, OS/browser, network type, pass/fail and a short observation. Do not publish credentials, invite links or call footage. **These checks are pending.** Browser-tab checks and automated outcomes must be reported separately.

| Scenario | Procedure | Required result |
| --- | --- | --- |
| Shared text | Create/join a room. Send 20 alternating messages A01, B01 … A10, B10. | Both histories contain exactly 20 ordered messages; outgoing server ACK and partner receipt appear without missing/duplicate text. |
| Invites/two slots | Try a changed invite and join the valid invite from a third independent browser. | Both attempts are rejected; no transcript is exposed. |
| Media defaults | Join a fresh room before allowing camera/mic. | Media remains off; typing works; device preferences are independent. |
| Different-network media | Enable both cameras. For audio, enable microphones, choose Text output and explicitly enable Listen to partner audio. | Live video/audio work both ways. Natural signing needs no model/AI; ISL and ASL are not automatically translated. |
| Forced relay | On both devices enable Video connection options → Require video relay, then Reconnect video. Once connected, choose Check video route. | Video/audio work and the selected route shows relay on both devices. Route status alone does not prove media quality; incomplete statistics stay unknown. A private Chrome `chrome://webrtc-internals` diagnostic can supplement the check; do not publish its address/credential details. |
| Playback recovery | If browser autoplay blocks the partner stream, use Play partner video/audio with mouse or keyboard. | Playback retries the existing stream and keeps camera/text/relay status intact. Repeated failure remains actionable; an old attempt cannot overwrite the current stream state. |
| Relay unavailable | Separately run a local server without Metered settings and require relay. | Relay unavailability is clear and text stays usable. Direct video on some networks is not proof of cross-network reliability. |
| Media permission denial | Block camera/mic on one device, then retry. | Actionable error; reviewed typing/sending still works. |
| Speech review | Dictate, finish, correct a word, then Send to partner. | Only reviewed text is sent; app speech stops and partner audio is muted during dictation. No automatic Gemini call. |
| Preference changes | Change Type/Speak/Sign and Text/Read aloud/Screen reader during the room, sending after each change. | History/draft survive; new messages announce once. Changing preference/reconnecting does not replay old history. Missing speech support leaves typing usable. |
| Saved sign videos | Send a saved matching phrase and an uncovered phrase with Show saved sign videos enabled. | Matching local clip plays; missing coverage stays explicit text. Videos are not copied to the partner's library. |
| Word recognition | On the local model-enabled laptop, capture/review a word while sharing video. Also check the public build without weights. | Recognition shares the preview, requires review, and never auto-sends. Missing weights are explained; live signing remains available. This is a behavior test, not accuracy measurement. |
| Disconnect/retry | Type a draft, briefly disable one device's network, restore it and retry an uncertain message without editing it. | Same identity/history return if the room exists. Draft survives, same-ID retry avoids duplicates, and video rebuilds without stale peer media. |
| Leave/end/restart | Leave or End for both; separately restart the test server with a room active. | Room ended is shown where possible; old invites/credentials cannot recover its transcript. Draft remains for a new room; media tracks stop. |
| Keyboard/accessibility | Use Tab/Shift+Tab/Enter/Space and NVDA; separately Android TalkBack. | Clear names/visible focus; new messages announce without competing app TTS; typing/sending work without a mouse. User feedback remains required. |
| AI optional | Keep Gemini unset for human communication, then optionally test explicit AI draft help after setup. | Human conversation works without Gemini requests; an AI suggestion is never automatically sent to the partner. |
| Message clarification | Send an unclear entrance/time message. Its recipient requests clarification; the sender reviews and sends an answer; the requester marks it resolved. | Request/answer link to the original. Resolution records the requester's choice. Read aloud/screen reader identify the original context. Ordinary Send requires no approval. |
| Preserved correction | Correct your own sent message, then follow its original-message link using Enter. | Correction is a new message, original wording remains, and keyboard focus reaches the original. A recipient cannot edit the sender's wording. |
| Meeting revision | Share all required fields. Both approve revision 1. Change the time; test an edit/approval from an older view before reviewing revision 2. | Both approvals reset; stale actions are rejected. Both must explicitly approve revision 2. History retains the earlier fields and readable output covers all fields/status. |
| Shared references | Send a message with a labeled description; rename/revise it and send another message. | Earlier message retains revision 1's label/description. Later message uses the new snapshot. Read aloud includes the description; missing saved sign coverage is explicit. |
| Workflow reconnect | Keep a linked answer/correction draft with a reference, interrupt networking, and reconnect. If an action's delivery is uncertain, retry only after reviewing its status. | Draft/context/history return. Accepted action reconciliation and same-ID retries avoid duplicates; an old approval never becomes approval of an edited revision. |

A failed relay/video check does not negate the separate text result. Re-run relevant checks after deployment/configuration changes.

## Limits and recovery

- Text limit: 2,000 Unicode characters. Latest 200 messages are visible; at 2,000 unique IDs, start a new room. This bounds memory while retaining duplicate suppression.
- Shared workflow limit: 200 visible events, 100 clarification requests, 25 cards with at most 20 revisions each, 25 references, 2,000 accepted action IDs per room and 256 KB of serialized workflow data. Message snapshots, including reference descriptions, are capped at 16 KB. Rejections occur before assigning order or retaining an ID; accepted IDs are not forgotten to make space.
- A browser retains at most 64 unconfirmed actions and 128 recent rejection outcomes. Pending retries keep immutable details; definite failures leave the pending queue. Review a failed action and submit a new ID rather than reusing it with changed details.
- A disconnect reserves both identities. Resume with the same tab credentials, rather than rejoining as a new participant. Opening the same identity elsewhere replaces the previous socket.
- Empty rooms expire after 30 minutes. Server restart/sleep, a delivered Leave/End, or opening a Tool while connected ends the room. An offline exit releases only this device and cannot notify the partner; End for both is unavailable until reconnect. There is no durable history/account recovery.
- Browser speech can use online vendor services; installed voices vary. Videos/samples remain browser/origin-local. No bundled human sign videos, fluent avatar, continuous translator or Braille hardware are claimed.
- For a bad rollout, redeploy the prior tested build through the dashboard; this ends rooms. Re-run text/media/relay acceptance. Do not enable paid resources as automatic recovery.
