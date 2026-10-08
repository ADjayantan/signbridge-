import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import RecognitionReportDownload from "../../src/components/RecognitionReportDownload.jsx";
import SignRecognitionDetails from "../../src/components/SignRecognitionDetails.jsx";

const exportTime = "2026-10-05T08:30:00.000Z";
const downloadButton = () => screen.getByRole("button", { name: "Download recognition report" });
let blobs, createObjectURL, revokeObjectURL, anchorClick, fetchRequest, speak, store;

function rejectedTurn() {
  const privateObject = { value: "PRIVATE_ARBITRARY_OBJECT" };
  privateObject.circular = privateObject;
  return {
    status: "unclear", score: .72, meaning: "PRIVATE_REVIEWED_WORD", glosses: ["PRIVATE_GLOSS"], feedback: "PRIVATE_FEEDBACK",
    roomId: "PRIVATE_ROOM", apiKey: "PRIVATE_KEY", userAgent: "PRIVATE_USER_AGENT", frames: ["PRIVATE_POSE"],
    diagnostics: {
      inferenceRan: true, reasonCodes: ["low-score", "small-margin"], arbitrary: privateObject,
      model: { signLanguage: "asl", engine: "legacy", labelsCount: 100, threshold: .98, requiredMargin: .3,
        acceptanceEnabled: true, weights: privateObject, modelId: "PRIVATE_MODEL_ID" },
      capture: { inputFrames: 12, handFrames: 10, shoulderFrames: 12, qualifiedFrames: 10,
        trimmedFrames: 11, trimmedShoulderFrames: 11, modelFrames: 32, durationMs: 1500, largestGapMs: 125,
        frames: ["PRIVATE_COORDINATES"], timestamps: ["1999-01-01T00:00:00.000Z"] },
      posterior: { topLabel: "MOTHER", topScore: .72, runnerUpLabel: "DRINK", runnerUpScore: .65,
        margin: .07, scorePassed: false, marginPassed: false, reviewedText: "PRIVATE_POSTERIOR_TEXT" },
      cameraGate: { passed: true, code: "framing", source: privateObject },
    },
  };
}

const quality = () => ({ count: 12, handFrames: 10, shoulderFrames: 12, clippedFrames: 0,
  durationMs: 1500, samplesPerSecond: 8, largestGapMs: 125, frames: ["PRIVATE_SOURCE_FRAME"],
  atMs: "PRIVATE_FRAME_TIMESTAMP", roomId: "PRIVATE_QUALITY_ROOM" });

function ReviewBesideReport({ result, onSubmit }) {
  const [reviewed, setReviewed] = useState("PRIVATE_REVIEWED_WORD");
  const [draft, setDraft] = useState("PRIVATE_UNSENT_MESSAGE");
  return <form onSubmit={onSubmit}>
    <label htmlFor="report-reviewed">Reviewed word</label>
    <input id="report-reviewed" value={reviewed} onChange={(event) => setReviewed(event.target.value)} />
    <label htmlFor="report-draft">Unsent message</label>
    <textarea id="report-draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <SignRecognitionDetails result={result} captureQuality={quality()} />
  </form>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(exportTime));
  blobs = [];
  vi.stubGlobal("Blob", class RecordedBlob {
    constructor(parts, options) { this.parts = parts; this.type = options?.type; blobs.push(this); }
  });
  let serial = 0;
  createObjectURL = vi.fn(() => `blob:recognition-report-${++serial}`);
  revokeObjectURL = vi.fn();
  const OriginalURL = globalThis.URL;
  vi.stubGlobal("URL", class ReportURL extends OriginalURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    expect(this.isConnected).toBe(true);
    expect(this.download).toBe("signbridge-recognition-report.json");
    expect(this.hidden).toBe(true);
  });
  fetchRequest = vi.fn();
  vi.stubGlobal("fetch", fetchRequest);
  speak = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
  store = vi.spyOn(Storage.prototype, "setItem");
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const downloadedReport = (index = blobs.length - 1) => JSON.parse(blobs[index].parts.join(""));
function expectLocalAndSilent() {
  expect(fetchRequest).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  expect(speak).not.toHaveBeenCalled();
}

test("opening diagnostics and receiving new results never creates an automatic report or download", () => {
  const app = render(<React.StrictMode><SignRecognitionDetails result={rejectedTurn()} /></React.StrictMode>);
  fireEvent.click(screen.getByText("Why this result?"));
  app.rerender(<React.StrictMode><SignRecognitionDetails result={rejectedTurn()} /></React.StrictMode>);
  act(() => vi.advanceTimersByTime(10000));
  expect(blobs).toHaveLength(0);
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(anchorClick).not.toHaveBeenCalled();
  expectLocalAndSilent();
  app.rerender(<SignRecognitionDetails result={{ status: "unclear" }} />);
  expect(screen.queryByRole("button", { name: "Download recognition report" })).toBeNull();
});

test("an explicit rejected-turn download includes tentative labels and scalar diagnostics while leaving review and communication untouched", () => {
  const onSubmit = vi.fn((event) => event.preventDefault());
  const result = rejectedTurn();
  render(<ReviewBesideReport result={result} onSubmit={onSubmit} />);
  const reviewed = screen.getByLabelText("Reviewed word"), draft = screen.getByLabelText("Unsent message");
  fireEvent.change(reviewed, { target: { value: "PRIVATE_CORRECTED_WORD" } });
  fireEvent.change(draft, { target: { value: "PRIVATE_CORRECTED_DRAFT" } });
  expect(screen.getByText(/tentative labels, model scores and capture counts/)).toBeTruthy();
  fireEvent.click(downloadButton());

  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(anchorClick).toHaveBeenCalledOnce();
  expect(blobs[0].type).toBe("application/json");
  const report = downloadedReport(), json = JSON.stringify(report);
  expect(report.format).toBe("signbridge-recognition-report-v1");
  expect(report.exportedAt).toBe(exportTime);
  expect(report.result.status).toBe("unclear");
  expect(report.result.posterior).toMatchObject({ topLabel: "MOTHER", topScore: .72,
    runnerUpLabel: "DRINK", runnerUpScore: .65, scorePassed: false, marginPassed: false });
  expect(report.captureQuality).toEqual({ count: 12, handFrames: 10, shoulderFrames: 12,
    clippedFrames: 0, durationMs: 1500, samplesPerSecond: 8, largestGapMs: 125 });
  expect(report.result.capture).toMatchObject({ inputFrames: 12, modelFrames: 32, durationMs: 1500 });
  expect(json).not.toMatch(/PRIVATE_|1999-01-01|frames|coordinates|weights|timestamps|meaning|glosses|feedback|roomId|apiKey|userAgent|modelId/);
  expect(report.purpose).toMatch(/no reviewed ground truth or recognition accuracy/);
  expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  expect(screen.getByText(/Nothing was uploaded or added to training/)).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
  expectLocalAndSilent();
  expect(reviewed.value).toBe("PRIVATE_CORRECTED_WORD");
  expect(draft.value).toBe("PRIVATE_CORRECTED_DRAFT");
  fireEvent.change(reviewed, { target: { value: "Still editable" } });
  fireEvent.change(draft, { target: { value: "Still unsent" } });
  expect(reviewed.value).toBe("Still editable");
  expect(draft.value).toBe("Still unsent");
  expect(result.meaning).toBe("PRIVATE_REVIEWED_WORD");
});

test("a download after early quality rejection cannot turn compatibility scores or injected labels into measured confidence", () => {
  const result = rejectedTurn();
  result.status = "no_sign"; result.score = 0;
  result.diagnostics.inferenceRan = false;
  result.diagnostics.reasonCodes = ["no-hands"];
  render(<SignRecognitionDetails result={result} />);
  fireEvent.click(downloadButton());
  const report = downloadedReport();
  expect(report.result.inferenceRan).toBe(false);
  expect(report.result.posterior).toBeNull();
  expect(JSON.stringify(report)).not.toMatch(/MOTHER|DRINK|topScore|runnerUpScore|"score":0/);
  expectLocalAndSilent();
});

test("a requested download releases its temporary URL shortly afterward without duplicate cleanup on unmount", () => {
  const app = render(<RecognitionReportDownload result={rejectedTurn()} />);
  fireEvent.click(downloadButton());
  const url = createObjectURL.mock.results[0].value;
  expect(revokeObjectURL).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1500));
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
  app.unmount();
  act(() => vi.advanceTimersByTime(1500));
  expect(revokeObjectURL).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test("replacing a result and unmounting revoke every outstanding download and cancel old expiry timers", () => {
  const app = render(<RecognitionReportDownload result={rejectedTurn()} />);
  fireEvent.click(downloadButton()); fireEvent.click(downloadButton());
  const oldURLs = createObjectURL.mock.results.map(({ value }) => value);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  const replacement = rejectedTurn(); replacement.diagnostics.posterior.topLabel = "HELP";
  app.rerender(<RecognitionReportDownload result={replacement} />);
  expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(oldURLs);
  expect(screen.queryByText(/Report download requested/)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.click(downloadButton());
  expect(downloadedReport().result.posterior.topLabel).toBe("HELP");
  const newURL = createObjectURL.mock.results[2].value;
  app.unmount();
  expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([...oldURLs, newURL]);
  act(() => vi.advanceTimersByTime(1500));
  expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

test("a failed anchor download releases resources, preserves the review and permits a clean retry", () => {
  anchorClick.mockImplementationOnce(() => { throw new Error("PRIVATE_DOWNLOAD_ERROR"); });
  const onSubmit = vi.fn((event) => event.preventDefault());
  render(<ReviewBesideReport result={rejectedTurn()} onSubmit={onSubmit} />);
  fireEvent.click(downloadButton());
  const failedURL = createObjectURL.mock.results[0].value;
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(failedURL);
  expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(screen.getByRole("alert").textContent).toMatch(/Could not download.*reviewed word and message are still available/);
  expect(screen.queryByText(/PRIVATE_DOWNLOAD_ERROR/)).toBeNull();
  expect(screen.getByLabelText("Reviewed word").value).toBe("PRIVATE_REVIEWED_WORD");
  expect(screen.getByLabelText("Unsent message").value).toBe("PRIVATE_UNSENT_MESSAGE");
  fireEvent.click(downloadButton());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(anchorClick).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Report download requested/)).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
  expectLocalAndSilent();
});

test("failure before a URL exists leaves no anchor or scheduled cleanup and retry can succeed", () => {
  createObjectURL.mockImplementationOnce(() => { throw new Error("Unsupported blob download"); });
  render(<RecognitionReportDownload result={rejectedTurn()} />);
  fireEvent.click(downloadButton());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(anchorClick).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.click(downloadButton());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(anchorClick).toHaveBeenCalledOnce();
  expectLocalAndSilent();
});

test("an invalid diagnostic result reports failure before creating a blob and new valid results clear that failure", () => {
  const app = render(<RecognitionReportDownload result={{ status: "unclear", diagnostics: { inferenceRan: "false" } }} />);
  fireEvent.click(downloadButton());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(blobs).toHaveLength(0);
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(anchorClick).not.toHaveBeenCalled();
  app.rerender(<RecognitionReportDownload result={rejectedTurn()} />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(blobs).toHaveLength(0);
  fireEvent.click(downloadButton());
  expect(anchorClick).toHaveBeenCalledOnce();
  expectLocalAndSilent();
});
