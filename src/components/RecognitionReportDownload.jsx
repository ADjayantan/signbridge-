import { useEffect, useRef, useState } from "react";
import { createSignRecognitionReport } from "../lib/signRecognitionReport.js";

export default function RecognitionReportDownload({ result, captureQuality }) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const downloads = useRef(new Map());
  useEffect(() => {
    setNotice(""); setError("");
    return () => {
      for (const [url, timer] of downloads.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
      downloads.current.clear();
    };
  }, [result]);
  const download = () => {
    let url = "", link;
    setNotice(""); setError("");
    try {
      const report = createSignRecognitionReport(result, captureQuality);
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url; link.download = "signbridge-recognition-report.json"; link.hidden = true;
      document.body.appendChild(link); link.click();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 1000);
      downloads.current.set(url, timer);
      setNotice("Report download requested. Nothing was uploaded or added to training.");
    } catch {
      if (url) URL.revokeObjectURL(url);
      setError("Could not download this report. Your reviewed word and message are still available.");
    } finally { link?.remove(); }
  };
  return <div className="recognition-report-download">
    <p className="fine-print">Download this turn's tentative labels, model scores and capture counts for troubleshooting. The report excludes video, audio, joint coordinates and your reviewed message. It is not a training sample or an accuracy test.</p>
    <button type="button" className="btn btn-small" onClick={download}>Download recognition report</button>
    {notice && <p className="hint" aria-live="polite">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
