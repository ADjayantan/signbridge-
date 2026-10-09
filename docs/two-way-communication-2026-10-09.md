# SignBridge’s two-way communication goal

The main purpose is to connect a person who uses signs with a person who does not know that sign language. Each person chooses an input and output; the app does not ask for a disability category.

## Intended conversation

1. A signer uses their camera. A supported sign is recognized as tentative text, which they check or correct before sending.
2. Their partner receives the reviewed message as visible text and browser-generated voice when **Text + voice** is selected.
3. The partner speaks or types a reply, reviews the transcript, and sends it.
4. The signer receives matching saved sign videos in their selected ISL or ASL, alongside the text. A missing video remains visibly unavailable; the system must not invent a sign or say the complete sentence was translated.

Human messages do not require Gemini. Optional AI help is a separate reviewed action. Recognition, message delivery, speech playback and sign-video availability are separate capabilities; passing a delivery test is not evidence of accurate sign translation.

## Setup implemented

**I use signs** selects Sign input, visible text and saved sign videos. **I use speech or text** selects dictation when available and Text + voice when browser speech is available, with typing retained throughout. Neither choice enables a camera, microphone, tracking, sends a message or asks AI. Both preserve the existing room, history, draft and language choices. Preferences apply to this device only and remain individually adjustable.

The conversation screen labels text and voice together, shows this browser’s saved-video availability and names the latest incoming video panel **Your partner’s reply in signs**. A clip saved on the laptop is not automatically available on a phone or on the public site’s separate origin. Available clips are user-provided and have not been independently validated by the app.

## Remaining work that determines usefulness

- Recognition is experimental and limited to isolated words. The public build excludes local research weights. HELLO or STOP gesture shortcuts do not establish broad sign-language understanding.
- Reverse output uses exact normalized phrase/word matching in the received text language and chosen sign language. Individual vocabulary clips played in text order do not supply sign-language grammar. There is no general speech-to-sign sentence translator.
- A bounded phrase pilot needs consented or licensed videos reviewed by fluent signers, delivered to both devices. Review the meaning, ISL/ASL variant, text-language labels and usability before calling a phrase supported.
- Validate sign recognition on held-out signers and actual cameras. Keep rejected/unknown input visible rather than forcing a word.
- Test the complete conversation with actual participants, including someone who prefers visual communication and someone who does not know signs. Do not simulate their lived experience as proof of accessibility.

## Repeatable pilot test

Use two devices with independent preferences. On the signer’s device select **I use signs**; on the partner’s select **I use speech or text**. Share a fresh invite. First send reviewed typed text to isolate delivery and text/voice output. Then use an available signer-reviewed phrase clip to verify the return video path. Separately attempt the corresponding real sign through the camera and record whether it was recognized, rejected or wrong. Keep model accuracy results separate from transport/output results. Missing clips, denied device access and unavailable speech must preserve typing and history.

## Software verification

The focused Connect suite passed 63 tests, including preserving drafts/history/languages, cancelling late dictation, runtime speech fallbacks, capture guards, one-time partner voice output with visible text, and the incoming sign-video request without AI or autoplay. Independent source review found no material regression. Integrated `npm run check` passed 282 Node and 357 UI tests (639 total), with the regular build; `npm run build:public` passed separately and excluded research weights. These tests do not establish webcam recognition, actual sign-video meaning, audible speech or two-device accessibility.
