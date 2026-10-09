import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TrainingStudio from "../../src/modes/TrainingStudio.jsx";

const mocks = vi.hoisted(() => ({ library: null, export: vi.fn(), blobs: [], downloads: [], revoke: vi.fn() }));
vi.mock("../../src/hooks/useTrainingSamples.js", () => ({ useTrainingSamples: () => mocks.library }));
vi.mock("../../src/lib/trainingSamples.js", () => ({ exportTrainingDataset: (...args) => mocks.export(...args) }));

const frames = () => Array.from({ length: 4 }, (_, step) => ({ atMs: step * 100, keypoints: Array.from({ length: 75 }, () => [.1, .2, .3]), confidences: Array(75).fill(1) }));
const sample = (id, signLanguage, kind, label, signerId, sessionId, step) => ({ id, signLanguage, kind, label, signerId, sessionId, consent: true, createdAt: Date.parse("2026-10-02T07:00:00Z") + step * 60000, frameCount: 4, durationMs: 2000, frames: frames() });
const samples = () => [sample("water", "isl", "known", "WATER", "signer-a", "session-a", 0), sample("help", "asl", "known", "HELP", "signer-b", "session-b", 1), sample("unknown", "isl", "unknown", "", "signer-a", "session-c", 2)];
const setup = () => {
  const onCapture = vi.fn(), update = vi.fn();
  const app = render(<TrainingStudio settings={{ signLanguage: "isl" }} update={update} onBack={() => {}} onCapture={onCapture} />);
  return { ...app, onCapture, update };
};
const count = (label) => within(screen.getByText(label).closest("div")).getByRole("definition").textContent;
const button = (name) => screen.getByRole("button", { name });
const filter = (value) => fireEvent.change(screen.getByLabelText("View sign language"), { target: { value } });
const flush = async () => act(async () => { await Promise.resolve(); });
const readBlob = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(JSON.parse(reader.result)); reader.onerror = reject; reader.readAsText(blob);
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.blobs = []; mocks.downloads = [];
  mocks.library = { samples: samples(), loading: false, error: "", add: vi.fn(), remove: vi.fn().mockResolvedValue(undefined), reload: vi.fn() };
  mocks.export.mockImplementation((records) => ({ format: "signbridge-pose-dataset-v1", exportedAt: "2026-10-02T08:00:00Z", samples: JSON.parse(JSON.stringify(records)) }));
  URL.createObjectURL = vi.fn((blob) => { mocks.blobs.push(blob); return `blob:dataset-${mocks.blobs.length}`; });
  URL.revokeObjectURL = mocks.revoke;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { mocks.downloads.push({ href: this.href, filename: this.download }); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("inventory counts distinguish known/unknown examples and filtering does not alter conversation language", () => {
  const app = setup();
  expect(count("Saved samples")).toBe("3"); expect(count("Known signs")).toBe("2"); expect(count("Unknown examples")).toBe("1");
  expect(count("Distinct labels")).toBe("2"); expect(count("Signers")).toBe("2"); expect(count("Sessions")).toBe("3");
  filter("asl");
  expect(count("Saved samples")).toBe("1"); expect(count("Known signs")).toBe("1"); expect(count("Unknown examples")).toBe("0");
  expect(screen.getByRole("rowheader", { name: /HELP/ })).toBeTruthy();
  expect(screen.queryByRole("rowheader", { name: /WATER/ })).toBeNull();
  expect(app.update).not.toHaveBeenCalled();
  fireEvent.click(button(/Capture a sample/)); expect(app.onCapture).toHaveBeenCalledOnce();
  expect(mocks.library.add).not.toHaveBeenCalled();
});

test("inventory distinguishes attested nonsigning, unsupported signs and unreviewed legacy unknowns", () => {
  mocks.library.samples = [
    { ...sample("idle", "asl", "unknown", "__unknown__", "person-a", "session-a", 0), negativeType: "nonsigning" },
    { ...sample("unsupported", "asl", "unknown", "__unknown__", "person-b", "session-b", 1), negativeType: "unsupported-sign" },
    sample("old", "isl", "unknown", "__unknown__", "person-c", "session-c", 2),
  ];
  setup();
  expect(screen.getByRole("rowheader", { name: /No intentional sign/ }).textContent).toContain("No intentional sign");
  expect(screen.getByRole("rowheader", { name: /Unsupported sign/ }).textContent).toContain("Unsupported sign");
  expect(screen.getByRole("rowheader", { name: /Unknown example/ }).textContent).toContain("Unreviewed type");
  expect(screen.queryByText("Unknown / no sign")).toBeNull();
  expect(screen.getByText(/Unknown types in this view:/).textContent).toContain("1 no intentional sign · 1 unsupported sign · 1 unreviewed type");
  filter("asl");
  expect(screen.getByText(/Unknown types in this view:/).textContent).toContain("1 no intentional sign · 1 unsupported sign · 0 unreviewed type");
  expect(mocks.library.add).not.toHaveBeenCalled();
});

test("repeated labels remain one class while each signer's same-named session is counted separately", () => {
  mocks.library.samples.push(sample("water-second-signer", "isl", "known", "WATER", "signer-b", "session-a", 3));
  setup();
  expect(count("Saved samples")).toBe("4"); expect(count("Known signs")).toBe("3");
  expect(count("Distinct labels")).toBe("2"); expect(count("Signers")).toBe("2"); expect(count("Sessions")).toBe("4");
});

test("filtered JSON export preserves complete pose data and reports a local download", async () => {
  setup(); filter("asl"); fireEvent.click(button("Export this view"));
  expect(mocks.export).toHaveBeenCalledOnce(); expect(mocks.export.mock.calls[0][0].map((record) => record.id)).toEqual(["help"]);
  const exported = await readBlob(mocks.blobs[0]);
  expect(exported.format).toBe("signbridge-pose-dataset-v1"); expect(exported.samples).toHaveLength(1);
  expect(exported.samples[0].signLanguage).toBe("asl"); expect(exported.samples[0].frames).toEqual(mocks.library.samples[1].frames);
  expect(mocks.downloads[0].filename).toBe("signbridge-training-asl.json");
  expect(screen.getByText(/Download requested for 1 sample in the ASL view/)).toBeTruthy();
  expect(document.querySelector("a[download]")).toBeNull();
});

test("Export all includes both languages even while viewing only ISL", async () => {
  setup(); filter("isl"); fireEvent.click(button("Export all samples"));
  const exported = await readBlob(mocks.blobs[0]);
  expect(exported.samples.map((record) => record.id)).toEqual(["water", "help", "unknown"]);
  expect(mocks.downloads[0].filename).toBe("signbridge-training-all.json");
  expect(screen.getByText(/Download requested for 3 samples across both languages/)).toBeTruthy();
});

test("deletion serializes mutations and cannot export a pending inventory snapshot", async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  mocks.library.remove.mockImplementation(async (id) => { await pending; mocks.library.samples = mocks.library.samples.filter((record) => record.id !== id); });
  setup(); const remove = button("Delete ISL WATER sample"); fireEvent.click(remove); fireEvent.click(remove);
  expect(mocks.library.remove).toHaveBeenCalledOnce(); expect(mocks.library.remove).toHaveBeenCalledWith("water");
  expect(button("Export all samples").disabled).toBe(true); expect(screen.getByLabelText("View sign language").disabled).toBe(true);
  fireEvent.click(button("Export all samples")); expect(mocks.export).not.toHaveBeenCalled();
  await act(async () => complete());
  expect(screen.queryByRole("rowheader", { name: /WATER/ })).toBeNull(); expect(count("Saved samples")).toBe("2");
  expect(screen.getByText(/Deleted WATER \(ISL\)/)).toBeTruthy(); expect(button("Export all samples").disabled).toBe(false);
});

test("failed deletion preserves the row and exposes a recoverable error", async () => {
  mocks.library.remove.mockRejectedValue(new Error("Storage blocked the deletion."));
  setup(); fireEvent.click(button("Delete ASL HELP sample")); await flush();
  expect(screen.getByRole("alert").textContent).toContain("Storage blocked the deletion.");
  expect(screen.getByRole("rowheader", { name: /HELP/ })).toBeTruthy(); expect(button("Delete ASL HELP sample").disabled).toBe(false);
  fireEvent.click(button("Reload samples")); expect(mocks.library.reload).toHaveBeenCalledOnce();
});

test("loading disables export until the complete inventory is available", () => {
  mocks.library.loading = true; const app = setup();
  expect(count("Saved samples")).toBe("—"); expect(button("Export all samples").disabled).toBe(true);
  fireEvent.click(button("Export all samples")); expect(mocks.export).not.toHaveBeenCalled();
  expect(screen.queryByRole("table")).toBeNull();
  mocks.library.loading = false;
  app.rerender(<TrainingStudio settings={{ signLanguage: "isl" }} onBack={() => {}} onCapture={() => {}} />);
  expect(count("Saved samples")).toBe("3"); expect(button("Export all samples").disabled).toBe(false);
});

test("an initial storage failure does not present missing data as an empty dataset", () => {
  mocks.library.samples = []; mocks.library.error = "Could not load saved samples.";
  setup();
  expect(count("Saved samples")).toBe("—"); expect(screen.getByText("Saved examples could not be loaded.")).toBeTruthy();
  expect(screen.queryByText("Start with one carefully labelled example.")).toBeNull();
  expect(button("Export all samples").disabled).toBe(true);
  fireEvent.click(button("Reload samples")); expect(mocks.library.reload).toHaveBeenCalledOnce();
});

test("failed manual reload is caught and leaves unavailable exports disabled", async () => {
  mocks.library.samples = []; mocks.library.error = "Could not load saved samples.";
  mocks.library.reload.mockRejectedValue(new Error("IndexedDB is still blocked."));
  setup(); fireEvent.click(button("Reload samples")); await flush();
  expect(screen.getByRole("alert").textContent).toContain("IndexedDB is still blocked.");
  expect(button("Reload samples").disabled).toBe(false); expect(button("Export all samples").disabled).toBe(true);
});

test("empty inventory guides explicit consent-based capture without auto-saving", () => {
  mocks.library.samples = []; const app = setup();
  expect(screen.getByText(/Nothing is saved automatically/)).toBeTruthy();
  expect(screen.getByText(/Saving examples does not retrain the model/)).toBeTruthy();
  expect(button("Export all samples").disabled).toBe(true);
  fireEvent.click(button("Open Capture")); expect(app.onCapture).toHaveBeenCalledOnce(); expect(mocks.library.add).not.toHaveBeenCalled();
});

test("invalid export creates no download and exposes the export error", () => {
  mocks.export.mockImplementation(() => { throw new Error("This sample contains invalid pose data."); });
  setup(); fireEvent.click(button("Export all samples"));
  expect(screen.getByRole("alert").textContent).toContain("invalid pose data");
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(mocks.downloads).toHaveLength(0);
  expect(button("Export all samples").disabled).toBe(false);
});

test("download URLs are released after handoff or immediately when navigating away", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const app = setup(); fireEvent.click(button("Export all samples"));
  expect(mocks.revoke).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1000)); expect(mocks.revoke).toHaveBeenCalledWith("blob:dataset-1");
  fireEvent.click(button("Export this view")); app.unmount();
  expect(mocks.revoke).toHaveBeenCalledWith("blob:dataset-2");
  act(() => vi.advanceTimersByTime(1000)); expect(mocks.revoke).toHaveBeenCalledTimes(2);
});
