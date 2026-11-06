# A detected sign and its next action

9 October 2026. The reported greeting was detected but appeared to produce no response. A successful recognition result, local speech, a partner message and an AI answer are separate operations.

## Diagnosis and changes

The live server's public AI status returned `configured: false` and `roomAuthRequired: true`. The key was not inspected. Missing configuration previously took second place to room authentication in the tools' setup notices, suggesting that room AI was available. Missing configuration now takes precedence. The older static-sign tool also now checks availability before enabling an AI send; signed and typed drafts remain intact while setup is missing, unavailable or room-only.

On the word workspace, the result explains **Speak this word** and **Add word to message**. In the explicitly selected AI purpose, a single reviewed word with an empty message draft can use **Confirm word & get AI reply**. This action invokes the existing AI request only after a click and only when that server supports configured standalone AI. A longer draft still uses the complete-message review/send flow. Failed or interrupted requests preserve the reviewed word. No greeting is fabricated and no tentative prediction is sent automatically.

Local workspace speech now shows starting, actual speech-start, completion or actionable playback-error status. Stop, new capture, review edits and leaving the page invalidate old playback callbacks. This feedback describes browser speech behavior, not whether a person actually heard audio.

In a partner room, adding a reviewed word confirms that it is in the draft and focuses the updated composer. The user still chooses **Send to partner**. A full draft rejects the addition without clearing the reviewed word or showing a success message. Draft additions remain possible while reconnecting. Incoming Read aloud preferences do not speak the user's own sign.

## Private AI setup and limits

Set `GEMINI_API_KEY` privately on the existing Render service's Environment page, then restart/deploy the service. Do not paste it into chat, source files, screenshots or `VITE_*` settings. The deployed server intentionally requires room authentication for AI requests; after setup, use **Connect → Optional AI help** for reviewed text. The standalone sign tools do not bypass that authentication. Local development can support standalone AI when its own server is configured.

Restarting Render ends rooms held in memory. Create a fresh invite afterward. TURN/Metered configuration enables video relay and is separate from Gemini replies.

Recognition accuracy remains unproven. Public builds still exclude private research weights. Hand joints or a gesture-shortcut label do not establish fluent sign translation. The user's HI capture was not independently reproduced with a real camera; regression fixtures cover greeting-to-action behavior, draft preservation, unavailable AI and speech failures.

## Verification

Focused root word-workspace/freshness/graph-capture suites: 65 tests passed. Focused static-sign/live tools: 35 passed. Focused room capture/conversation suites: 77 passed. Integrated `npm run check`: 282 Node + 347 UI tests (629 total) and the regular build passed. The public build passed separately and excluded research weights. Actual AI answers and physical audio remain dependent on private configuration and device testing.

Source commit `6460c123b96e66aae0e0ed112e845e39163348d2` was pushed to `codex/render-pilot`. Render deployment `dep-db4732nlot8c7381pmb0` reached **Deploy succeeded | Live** at 10:16:58 IST on 9 October. In the actual in-app browser, the existing PWA first offered **Update and reload**; applying it loaded the new `index-j1bVl2U-.js` bundle.

With the camera off, a typed `HI` remained in the draft after checking AI setup. The screen showed **AI replies need setup**, with AI sending disabled. **Speak my message** produced browser playback-start and completion feedback while preserving `HI`. This verifies the deployed UI and browser speech callback flow, not an actual recognized HI, an audible result or a Gemini answer. Private screenshots remain in ignored local logs.
