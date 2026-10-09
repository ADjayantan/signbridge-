import RecognitionReportDownload from "./RecognitionReportDownload.jsx";

const count = (value) => Number.isInteger(value) && value >= 0 ? value : "Unavailable";
const percent = (value) => Number.isFinite(value) && value >= 0 && value <= 1 ? `${(value * 100).toFixed(3)}%` : "Unavailable";

const reasons = {
  "no-hands": "No visible hand measurements reached recognition.",
  "acceptance-disabled": "Word acceptance is disabled because this model failed rejection calibration.",
  "hand-samples": "Too few hand samples captured the movement.",
  "shoulder-samples": "Too few samples included both shoulders.",
  "shoulders-during-sign": "Both shoulders were not measured often enough during the hand-visible movement.",
  "short-sequence": "The captured movement was too short for word recognition.",
  "low-score": "The top model score was below its required score.",
  "small-margin": "The top two suggestions were too close to choose a reliable word.",
  recognized: "The turn passed this model's score and separation checks. Review the word before using it.",
  "invalid-pose": "The pose measurements could not be read.",
  "sample-count": "A complete turn needs four to one hundred fresh pose samples.",
  timing: "Measured camera timing was missing or repeated.",
  duration: "The turn did not meet the supported capture duration.",
  framing: "Too few samples included a hand and both shoulders together.",
  "tracking-gap": "A camera tracking gap was too long; capture the complete word again.",
  recapture: "This turn could not reach word inference. Capture a new complete word.",
};

/** Diagnostics are descriptive; they never choose, correct, speak, or send a word. */
export default function SignRecognitionDetails({ result, captureQuality }) {
  const diagnostics = result?.diagnostics;
  if (!diagnostics) return null;
  const posterior = diagnostics.inferenceRan ? diagnostics.posterior : null;
  const messages = (diagnostics.reasonCodes || []).map((code) => reasons[code]).filter(Boolean);
  return <details className="workspace-quality recognition-details">
    <summary>Why this result?</summary>
    {messages.map((message) => <p key={message} className="hint">{message}</p>)}
    {!diagnostics.inferenceRan && <p>The word model was not evaluated for this turn. No model confidence was measured.</p>}
    <dl>
      <div><dt>Model language</dt><dd>{diagnostics.model?.signLanguage?.toUpperCase() || "Unavailable"}</dd></div>
      {diagnostics.capture && <>
        <div><dt>Captured pose samples</dt><dd>{count(diagnostics.capture.inputFrames)}</dd></div>
        <div><dt>Hand-visible samples</dt><dd>{count(diagnostics.capture.handFrames)}</dd></div>
        <div><dt>Shoulder-visible samples</dt><dd>{count(diagnostics.capture.shoulderFrames)}</dd></div>
      </>}
      {posterior && <>
        <div><dt>Top tentative label</dt><dd>{posterior.topLabel}</dd></div>
        <div><dt>Top model score</dt><dd>{percent(posterior.topScore)}</dd></div>
        <div><dt>Required score</dt><dd>{percent(diagnostics.model?.threshold)}</dd></div>
        <div><dt>Runner-up label</dt><dd>{posterior.runnerUpLabel}</dd></div>
        <div><dt>Score separation</dt><dd>{percent(posterior.margin)}</dd></div>
        <div><dt>Required separation</dt><dd>{percent(diagnostics.model?.requiredMargin)}</dd></div>
      </>}
    </dl>
    <p className="fine-print">Model scores are not accuracy percentages. Tracking counts describe measurements, not whether you signed correctly. A rejected turn does not prove that your sign was wrong.</p>
    {["recognized", "unclear", "no_sign"].includes(result.status) && <RecognitionReportDownload result={result} captureQuality={captureQuality} />}
  </details>;
}
