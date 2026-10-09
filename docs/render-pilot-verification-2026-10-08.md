# Render Free pilot verification — 8 October 2026

The [public SignBridge conversation app](https://signbridge-conversations.onrender.com/#connect) is live. Render's dashboard showed **Deploy succeeded | Live** and the service's compute label **Free**. Source branch: `codex/render-pilot`; [draft PR](https://github.com/ADjayantan/signbridge-/pull/1). No database, persistent disk or paid upgrade was created.

## Build correction

The first deployment at `7668834` failed because `NODE_ENV=production` caused `npm ci` to omit development dependencies, including Vite. The corrected build command is `npm ci --include=dev && npm run build:public`; start is `npm start` and health check is `/api/health`. Deployment `361a131` then built and started successfully on Render's port 10000. Research weights were excluded by the public build.

The restored build tooling revealed one advisory in the development dependency `source-map-js` 1.2.1. Its lockfile entry alone was updated to 1.2.2, the [patched version for GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Both full and production-only npm audits then reported zero known vulnerabilities. This is the audit result at this date, not a guarantee against all security issues.

After that patch, `npm run check` passed 275 Node checks, 320 UI checks and the regular build. `npm run build:public` also passed. The earlier training-only suite passed 159 Python checks; no weights were trained or promoted during this deployment.

## Verified online behavior

Two synthetic clients on this laptop contacted the actual deployed HTTPS/WSS service. They did not use a local test server. Thirteen checks passed:

- Health and app routes returned 200; four research-model URLs returned 404.
- An ephemeral room was created. Invalid invite returned 403; its second participant joined; a third was rejected with 409.
- ICE configuration required member credentials. The authenticated endpoint returned 200 and `relayAvailable: false`.
- Two authenticated WSS clients with the deployed origin exchanged twenty alternating messages. Both received identical server-assigned sender/order, acknowledgements and receipts, with zero duplicates.
- Retrying the same message ID did not add another message. Reconnecting restored the participant and exactly twenty messages with receipts.
- End reached both clients; the old invite returned 404 with `room-ended`. The test room was cleaned up.

Separately, the deployed app in the Codex browser created a room, reached **Room connected**, sent a reviewed typed message marked **Sent**, and ended that disposable room. Camera and microphone were left off; no AI action was taken.

The repeatable synthetic script and outcome log are ignored local evidence under `logs/remote-pilot-smoke-2026-10-08.*`. No room credentials, private invites or ICE credentials were written to the report. Browser screenshots remain ignored local evidence rather than published account/camera captures.

## Limits and next gate

This proves deployment and the remote text protocol on synthetic clients. It does not prove communication on two physical devices, WebRTC camera/audio, forced relay, audible speech, screen-reader usability or sign-recognition accuracy. Private TURN setup and the [physical-device checklist](conversations-deployment.md#physical-two-device-acceptance) remain pending.

Local research weights are intentionally absent. Hosting does not improve BOOK/DRINK recognition or turn this into a continuous sign translator. Saved sign videos remain browser-local and are not transferred from the laptop by deployment.

Free instances can sleep/restart, ending in-memory rooms. Ordinary service auto-deploy is off; Blueprint configuration syncs and explicit deploys may still restart rooms. See [Render Free behavior](https://render.com/docs/free).
