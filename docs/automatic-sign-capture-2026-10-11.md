# Automatic isolated-sign capture — 11 October 2026

## Behavior

The local `/#trained-sign` workspace now defaults to **Automatic sign capture**.
Choose **Start camera + read aloud**, keep both shoulders and the signing hands
visible, perform one complete supported sign, then pause. The app segments the
movement, calls the existing word model, displays its result, and reads an
accepted tentative legacy-model word when read aloud is enabled. No Capture /
Finish click is required. **Start camera** alone keeps speech as an explicit
option. Turn automatic capture off to use the existing manual workflow.

The segmenter decides movement boundaries only. It never assigns HELLO to an
open palm, inserts an expected label, or lowers classifier confidence gates.
The currently available model and language vocabulary still determine which
words can be recognized. Uncertain results remain silent. Graph-model results
continue to require explicit reviewed speech. AI and partner messages still
require an explicit send; camera activity never sends to AI automatically.

## Boundaries and lifecycle

- Motion uses shoulder-relative hand joint displacement in image x/y space.
  Framing must be stable first. A held hand does not repeatedly start a turn.
- A 700 ms quiet interval completes a movement; a 600 ms loss of hands can also
  finish an already active movement. A completed turn has real measured times
  and samples. Maximum capture is 8 seconds / 100 samples.
- A 700 ms cooldown plus a quiet release prevents immediate repeats. A new
  deliberate movement can recognize the same word again.
- Stale tracking, dark camera, bad framing, device/model changes, End, Escape,
  and mode switches discard pending work. Async result ownership prevents a
  cancelled or expired turn from later speaking.
- Focusing a text field or opening More result options pauses capture to protect
  edits. Focus on switches or destination radios does not pause it. Automatic
  results do not steal keyboard focus.

## Verification

`npm run check` passed: **341 Node tests, 480 UI tests**, and the normal build.
`npm run build:public` also passed after the full check and confirmed that local
research model artifacts were excluded. Vite still reports the existing large
bundle warning; the decorative Three.js module remains loaded on demand.
The new suite includes 17 deterministic segmenter tests and 19 integration
cases using the real segmenter with synthetic poses / mocked model outcomes.
Those cases verify display/speech routing, repeated words, uncertain silence,
editing, switch focus, Escape, tracking expiry, async cancellation, and explicit
AI confirmation. They do **not** establish recognition accuracy.

In the actual Codex in-app browser, the Integrated Camera produced fresh real
body/hand frames and an automatic completed turn without Capture / Finish:
**29 samples, 3.6 s, 19/29 hand frames, 29/29 shoulder frames, 8.1 samples/s,
longest gap 141 ms**. The unchanged model returned **No reliable word match**.
This verifies real automatic capture and rejection in the browser, not a
successful HELLO recognition. No known sign was physically performed by the
agent. Accepted live HELLO recognition and human audible speaker confirmation
remain to be tested by a person.

Browser checks verified default-on automatic mode, manual controls when off,
restoration when on, read-aloud opt-in, and End returning to Camera off. New
controls fit 1440, 390, and 320 px viewports without horizontal overflow.
The saved UI proof shows the camera off and contains no webcam image:
[Automatic workspace](ui-automatic-sign-2026-10-11.jpg).

## Next actual-device check

1. Open `http://127.0.0.1:5174/#trained-sign`, select the matching language, and
   use **Start camera + read aloud**.
2. Wait for fresh tracking and visible shoulders / signing hands. Show a
   verified supported moving sign, then pause briefly.
3. Record whether automatic capture starts, the word/result shown, and whether
   speech is audible. A joint overlay alone is not a recognized word.
4. Hold still: there should be no repeated word or speech. Deliberately repeat
   the sign after a pause: another turn should be possible.
5. Try ordinary movement / an unsupported sign. Record any false positive;
   do not count a manually corrected or chosen word as model recognition.

This remains isolated-word experimentation. Long pauses within a sign can
split it, very slow or still signs may need manual capture, and ordinary motion
can trigger a rejected turn. Continuous signing, sentence translation, and
unseen-signer accuracy have not been established. Public demo builds continue
to exclude private research weights and datasets; deploying this UI alone
does not make word recognition available online.

## Paused after live user testing

The user requested continuing after the usage reset. No recognition fix was
confirmed in the voice session. Resume with the recognition investigation,
not another UI redesign.

- Actual Chrome webcam preview and joint tracking were working. A duplicate
  Codex preview's camera-busy error was separate from the user's Chrome test.
- ASL model metadata has 100 labels, excluding HELLO, HI and STOP. A rejected
  ASL turn had 29 hand/shoulder samples, CANDY score 28.430%, separation 4.883%;
  gates remain 98% / 30%. CANDY was a tentative rejected guess, not translation.
- User selected ISL and tried HELLO; this live test also failed. ISL has 49
  labels including HELLO, with 95% / 30% gates. Inspected rejected turn had 13
  samples, six hand-visible, all shoulders visible; top FATHER score 54.276%.
  Any manually selected BANK text is a reviewed choice, not recognition.
- Real camera dimensions are 640 x 480. The current fixed ISL adapter is
  empirically matched to reference footage around 1920 x 1080 (decoded probe
  1920 x 1088), with archive axes scaled x x 1080, y x 1920. The adapter has
  a mathematically demonstrated aspect dependence; this is a hypothesis for
  live failure, not a proven cause or verified fix. Do not blindly replace it
  with source pixel coordinates or lower acceptance gates.
- Current automatic capture requires motion; still-pose capture is not
  implemented. Adding it alone cannot teach the classifier new signs.
- Built-in speaker test reached browser Speaking then playback-ended states.
  Actual audible sound was not confirmed by the user.

Next: compare the same permitted ISL HELLO reference under original geometry
and aspect-preserving 4:3 framing, using the same tracker and unchanged model.
Test an actually verified 16:9 webcam stream if available. Separate framing,
temporal boundaries, signer/sign correctness and preprocessing effects. If
the model still fails, improve evaluated training with verified examples and
nonsigning controls. The first acceptance goal remains actual webcam HELLO
to correct visible text and human-confirmed audible speech. Expand vocabulary
only after that evidence. No model files or thresholds changed during this
investigation; no code changes after the automatic-capture build.

## Resumed after the limit reset — 11 October

The paused notes above describe the failed live session, not the current code.
This resume implements three bounded improvements:

- Fresh, complete, framed hands held stable for at least **1.2 seconds** now
  produce one measured `held-pose` attempt through the unchanged model gates.
  The same hold cannot repeatedly infer or speak. A measured release or
  substantial pose change rearms it. Motion has priority, including on the
  dwell boundary. Escape cancels a pending hold and latches it until release.
- The trained-sign screen requests **ideal 1280×720 / 16:9**; all other camera
  consumers retain their existing defaults. Actual decoded dimensions appear
  on the page. This laptop returned **1280×720**, with live shoulder tracking.
  No actual HELLO was performed in that check; End released the camera.
- A local **Watch example / Half speed** HELLO guide now uses the existing
  hash-checked INCLUDE validation video. It pauses when the camera starts.
  Watching cannot invoke recognition, speak, fill the draft or send to AI.
  Model/language availability is checked explicitly. The clip stays in ignored
  `.training-data`; its fixed loopback-only Vite route is absent in public-demo,
  preview and production. The [dataset card](https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md)
  supplies attribution, CC BY 4.0 licensing and regional-scope limits.

A real Tasks Holistic/canvas experiment reproduced the aspect sensitivity:
original reference footage was accepted as HELLO, whereas centered 4:3 padding
was rejected. An explicit diagnostic correction restored acceptance for the
1920-wide padded reference, but a resized 640×480 condition still rejected at
94.300% against the unchanged 95% gate. Geometry alone is not a sufficient fix.
The diagnostic helper is **not wired into live inference**. Original weights,
model metadata and acceptance gates remain unchanged.

The [first experiment report](hello-geometry-replay-2026-10-11.json) records
source-clock sequential sampling at 8/25 fps, not realtime throughput. Its
initial decoded height was 1088; later guide playback reported nominal 1080.
That first run did not audit each seek's dimensions, so a repeatable harness
must explicitly record/check intrinsic geometry before interpreting padding
as a pixel-preserving comparison. Neither run establishes unseen-signer
accuracy or the user's webcam HELLO result. Archive resampling checks also show
sampling-phase sensitivity; simply adding more pre-roll was not supported.

The subsequent [dimension-audited repeat](hello-geometry-audited-2026-10-11.json)
used `scripts/reference-geometry-replay.browser.js`, pinned the exact model and
video hashes, and checked dimensions at **every sampled frame**. Metadata height
was 1080; decoded height was 1088 throughout all five conditions. It reproduced
all five scores exactly, with unchanged timing/quality/acceptance gates. The
1920-wide original and padded conditions preserved decoded pixels; only the
640×480 condition resized them. This confirms the aspect experiment's result,
while retaining the limits on one known validation example and no live webcam
recognition proof. The script returns scalar evidence only and is never
imported by the product. No reference video or private model was copied into
public assets.

Full `npm run check` passed: **367 Node tests, 500 UI tests, normal build**.
The initial unconstrained UI run had resource timeouts; those suites passed
in isolation. Bounding jsdom to four workers then passed the full check with
the original assertions and timeouts. Focused tests cover static/moving
capture, repeated output, cancellation, guide isolation, local-route access,
and camera format lifecycle. Synthetic UI outputs are not physical-sign tests.
`npm run build:public` passed last, with research model artifacts excluded.

The user answered **“Innum test pannala”** to the new camera trial. Actual
webcam HELLO → correct visible text → human-confirmed audible speech remains
pending. Start with the complete example movement, both shoulders and signing
hand visible; do not count a manual word choice as recognition. Public builds
still exclude research models; these local changes are not a public-model
deployment or a claim that continuous sign translation works.

UI proof with camera off: [HELLO practice page](ui-hello-practice-2026-10-11.jpg).
