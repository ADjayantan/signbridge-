# Connect sign-to-voice controls — 3 October 2026

The Connect page could recognize/review a word and append it to a draft, but it had no local speech action for that reviewed word or unsent draft. Receive as Read aloud controls new partner messages, so a user testing signs on their own device could receive no voice output despite having reviewed text.

## Changes

- **Speak reviewed word** reads the current reviewed/corrected word on this device without adding or sending it. An empty rejected result stays silent; choosing a candidate does not automatically speak it.
- **Read my draft aloud** reads the current draft and keeps its wording/source metadata intact. It works during a room disconnection and does not require an AI request.
- **Test voice** in Communication preferences provides a user-initiated playback check before joining a room. Local test speech is English; captured model vocabulary retains English speech metadata even under Tamil text preferences.
- Starting playback stops dictation, mutes received audio and disables the broadcast microphone so the app does not transcribe/broadcast its own speech. Starting a new sign capture stops playback. Stop controls, language/input changes, leaving and owned-word cleanup cancel the appropriate speech session; late callbacks cannot revive canceled UI state.
- The speech helper now reports synchronous browser failures, asynchronous playback/voice errors and timeouts. Intentional cancellation stays silent. Existing callers remain compatible because errors resolve a structured status rather than reject the promise.
- Native speech is invoked immediately from the button path. A temporarily empty voice inventory does not prevent that request. Queue timeouts account for preceding queued speech instead of incorrectly timing out a short utterance behind a longer one.

## Verification

After these changes, `npm run check` passed **190 Node tests + 209 UI tests in 20 files = 399 application checks**, zero failures, followed by a successful production/PWA build. The new regressions cover explicit reviewed-word speech, uncertain/manual candidates, unavailable speech, correct language, draft preservation, local pre-room voice testing, mic safety, stop/cleanup, playback failure and late callbacks. Shared voice/sign/workspace callers also passed.

These speech/media checks use mocked native events. **Audible laptop output and a fresh live sign-to-voice trial were not verified**: browser inspection of the localhost tab was previously blocked by browser security policy. No alternate browser or indirect browser-command workaround was used for inspection. The user's separate room was not joined or ended, and no camera clip/text was sent to AI by this work.

The model weights and recognition accuracy are unchanged. Speech reads reviewed text; it does not make an unrecognized sign recognizable or provide continuous sign sentence translation. Existing dataset limits are in [the sign-to-text report](sign-to-text-test-2026-10-03.md).

## Try on the laptop

1. Open Communication preferences and press Test voice. If playback fails, the page shows its error and recovery guidance.
2. Choose Sign, turn on the camera and enable local word recognition. Keep a signing hand and both shoulders visible.
3. Capture one supported word, perform its complete sign and press Finish sign.
4. Review/correct the meaning and press Speak reviewed word. To speak a longer message, add reviewed words and press Read my draft aloud.
5. Your partner can separately choose Receive as Read aloud for received messages. Local playback is not a replacement for sending the reviewed message.
