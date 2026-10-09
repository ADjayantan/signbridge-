# Live Sign conversation

The goal is a sign conversation with the continuity and interruption controls of voice mode. Live Sign is a reviewable preview connecting short video turns to a generic multimodal model. A separate `/#trained-sign` route now uses local GRU models trained on 49 ISL / 100 ASL isolated words; it is not yet a validated continuous-sign translator. See [the actual training report](model-training-2026-10-01.md).

## Flow and state

`idle → ready → capturing → preview → interpreting → review → thinking → replied → next turn`

The user explicitly starts a session; the camera is inactive before that. A signed turn is bounded to 12 seconds/2 MB and contains only camera video. The user can replay it locally and choose to share it. Interpretation and answering are separate operations: only user-confirmed text enters chat history. Typed turns use the same conversation. The last six completed exchanges provide context; interrupted/failed exchanges do not.

Every capture or request belongs to a monotonically increasing turn generation. Interrupt, end, new capture and unmount cancel the owned work and invalidate its generation. Late callbacks cannot overwrite the new turn, append to history or start speech. End releases the camera. Changing either language remounts the session, cancelling old work.

Hand landmarks are local framing feedback. Optional hands-down finishing is a simple visibility heuristic, off by default. It is not a learned sentence-boundary detector. Face, body and hands remain in the video input because hand landmarks alone omit non-manual markers and signing context.

## Server contract

`GET /api/chat?status=1` returns only configured/not-configured and clip limits. It performs no inference and does not prove that a key, quota or model works.

`POST /api/chat` with `mode: "sign-video"`, `lang`, `signLanguage: "isl" | "asl"`, `videoConsent: true`, `duration`, inline MP4/WebM data and a user prompt returns:

```json
{"status":"recognized | unclear | no_sign","meaning":"tentative sentence","glosses":["SUPPORTED GLOSS"],"feedback":"review/framing guidance"}
```

The server validates MIME/base64 shape, decoded size, declared duration, selected sign language and consent. Both actual streamed request size and the local middleware's received size are capped at 3 MB. Inputs are held in memory and sent inline; the proxy does not save files or request bodies. This does not specify Google's retention policy, which depends on the API account's terms.

The video model is configurable with `GEMINI_SIGN_MODEL` (default `gemini-3.5-flash`, or `GEMINI_MODEL` when provided). Video sampling uses 8 FPS, compared with Google's default 1 FPS; see [the official Generate Content video documentation](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding). This improves temporal sampling density, not measured signing accuracy. Clips remain request/response turns, not a realtime bidirectional streaming connection. Upstream requests have a 30-second timeout.

Structured responses are strict. No raw-text fallback becomes a recognized sign. An unclear/no-sign result always has blank meaning/glosses, even if the upstream supplies guesses. The prompt treats video instructions as content and forbids room/appearance-based inference, but prompting does not guarantee recognition correctness. The user remains the final reviewer.

After confirmation, `mode: "sign"` receives the reviewed natural-language sentence, not uncertain glosses, and returns a short answer. The API key is server-only. Public hosting would still need authentication, quotas and rate limits; CORS restrictions alone are insufficient.

## Sign replies

Real saved phrase videos are preferred to a generic animated hand or unvalidated generated avatar. Exact phrases preserve their contributor's full signing. Partial coverage plays vocabulary clips in text order and explicitly shows missing signs. This does not implement sign-language grammar. Clips are separated by ISL/ASL and text language. No licensed human sign videos are bundled.

## Work needed for a sign-language model

1. Define the first deliverable: isolated word recognition, continuous sign recognition or translation to/from full sentences. These require different labels and evaluation.
2. Obtain licensed, consented ISL and ASL temporal datasets separately, with fluent-signer review. Do not label ordinary gestures as full sign vocabulary. Preserve face/body/non-manual context where appropriate.
3. Establish temporal baselines and train/evaluate on signer-separated splits. Report unknown-sign rejection, word/sequence errors, latency and performance across lighting, handedness, camera framing and signer diversity. Static-photo accuracy is not a sentence-translation metric.
4. Package the validated inference model and vocabulary with an explicit version and unsupported-language behavior. Use the session's interpretation/review boundary to integrate it. A local model could avoid cloud video uploads; it would need device performance testing and a different consent description.
5. Build a fluent-signer-reviewed reply corpus or a validated text-to-sign system. Avatar movement requires correct sign-language grammar and motion, not decorative hand animation.

Local isolated-word weights and dataset results are now available in the separate trained mode. They do not replace Live Sign's cloud interpretation or generate signed replies. Live Sign inference evaluation still requires an API key; trained-word recognition and English word speech do not.
