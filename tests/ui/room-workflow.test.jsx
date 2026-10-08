import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MeetingCard, ReferencesSection, RoomMessage } from "../../src/components/RoomWorkflow.jsx";
import { messageSummary, workflowEventSummary } from "../../src/lib/roomWorkflow.js";

vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true }));
vi.mock("../../src/components/SignVideoPlayer.jsx", () => ({ default: ({ text, signLanguage }) => <p>Available saved clips only: {signLanguage} · {text}</p> }));
afterEach(cleanup);
const fields = { date: "2026-10-10", time: "15:00", timeZone: "Asia/Kolkata", place: "Entrance B", note: "Bring Form A" };
const card = (revision = 1, extra = {}) => ({ id: "card1", revision, lang: "en", fields, approvals: [], history: [], ...extra });

test("stale meeting edit preserves typed fields until explicit current-revision review, then starts a new action", async () => {
  const sendAction = vi.fn().mockResolvedValueOnce({ ok: false, code: "stale-revision", error: "Review revision 2" }).mockResolvedValueOnce({ ok: true, id: "fresh_action" });
  const props = { participantId: "host", connected: true, sendAction, lang: "en", onRead: vi.fn() };
  const app = render(<MeetingCard {...props} card={card()} />);
  fireEvent.click(screen.getByRole("button", { name: "Propose an edit" })); fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: "My proposed entrance" } });
  app.rerender(<MeetingCard {...props} card={card(2, { fields: { ...fields, place: "Partner changed entrance" } })} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save new revision" })));
  expect(sendAction.mock.calls[0][0]).toMatchObject({ baseRevision: 1, fields: expect.objectContaining({ place: "My proposed entrance" }) });
  expect(screen.getByLabelText(/^Place/).value).toBe("My proposed entrance"); expect(screen.getByRole("button", { name: "Save new revision" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Review current revision 2" })); expect(screen.getByLabelText(/^Place/).value).toBe("Partner changed entrance");
  fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: "Jointly reviewed entrance" } }); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save new revision" })));
  expect(sendAction.mock.calls[1][0]).toMatchObject({ baseRevision: 2, fields: expect.objectContaining({ place: "Jointly reviewed entrance" }) }); expect(sendAction.mock.calls[1][0]).not.toHaveProperty("id");
});

test("a new card revision keeps historical wording while approvals refer only to current details", () => {
  render(<MeetingCard card={card(2, { fields: { ...fields, time: "16:00" }, history: [{ revision: 1, fields, lang: "en" }], approvals: ["host", "guest"] })} participantId="host" connected sendAction={vi.fn()} lang="en" onRead={vi.fn()} />);
  expect(screen.getByText("Both approved these details")).toBeTruthy(); fireEvent.click(screen.getByText("Previous revisions"));
  expect(screen.getByText(/Time: 15:00/)).toBeTruthy(); expect(screen.getByText(/Approval status belongs to the current revision/)).toBeTruthy();
});

test("meeting sign output requests saved clips and keeps all fields and approval status in the visible source text", () => {
  render(<MeetingCard card={card()} participantId="host" connected sendAction={vi.fn()} lang="en" onRead={vi.fn()} showSignVideos clips={[]} signLanguage="isl" />);
  fireEvent.click(screen.getByText("Available saved sign clips for these details"));
  const request = screen.getByText(/^Available saved clips only:/); expect(request.textContent).toContain("isl"); expect(request.textContent).toContain("Entrance B"); expect(request.textContent).toContain("Awaiting both approvals");
});

test("reference creation validates descriptions and sends only the explicitly reviewed human wording", async () => {
  const sendAction = vi.fn().mockResolvedValue({ ok: true, id: "ref1" });
  render(<ReferencesSection references={[]} connected sendAction={sendAction} lang="ta" onRead={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a shared reference" })); fireEvent.change(screen.getByLabelText("New reference label"), { target: { value: "Form A" } });
  expect(screen.getByRole("button", { name: "Share reference" }).disabled).toBe(true); expect(screen.getByLabelText("New reference description").maxLength).toBe(1000);
  fireEvent.change(screen.getByLabelText("New reference description"), { target: { value: "Library membership application" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share reference" })));
  expect(sendAction).toHaveBeenCalledWith({ kind: "reference.create", label: "Form A", description: "Library membership application", lang: "ta" });
});

test("a correction link transfers focus to its original message without changing the conversation route", () => {
  const original = { id: "original1", senderId: "host", text: "Original time 3 PM", lang: "en", inputMethod: "text" };
  const correction = { ...original, id: "correction1", text: "Correct time 4 PM", relation: { kind: "correction", messageId: original.id } };
  const props = { messages: [original, correction], participantId: "host", connected: true, sendAction: vi.fn(), lang: "en", onCompose: vi.fn(), onRead: vi.fn() };
  render(<><RoomMessage {...props} message={original} /><RoomMessage {...props} message={correction} /></>);
  const target = document.getElementById("room-message-original1"); target.scrollIntoView = vi.fn();
  fireEvent.click(screen.getByRole("link", { name: "Original time 3 PM" })); expect(document.activeElement).toBe(target); expect(target.scrollIntoView).toHaveBeenCalledOnce();
});

test("request resolution is a reported participant action, not an automatic understanding claim", () => {
  const message = { id: "message1", senderId: "host", text: "Go to entrance B", lang: "en", inputMethod: "text" };
  render(<RoomMessage message={message} messages={[message]} clarifications={[{ id: "clarify1", messageId: message.id, requesterId: "guest", reason: "repeat", status: "resolved" }]} participantId="host" connected sendAction={vi.fn()} lang="en" onCompose={vi.fn()} onRead={vi.fn()} />);
  expect(screen.getByText("Partner marked this resolved")).toBeTruthy(); expect(screen.queryByRole("button", { name: "Mark request resolved" })).toBeNull(); expect(screen.queryByText(/Partner understood/)).toBeNull();
});

test("accessible linked summaries include original wording and describe unavailable history truthfully", () => {
  const original = { id: "original1", text: "Original time 3 PM" };
  const corrected = { id: "correction1", text: "Correct time 4 PM", relation: { kind: "correction", messageId: "original1" } };
  expect(messageSummary(corrected, [original])).toBe("Correction: Correct time 4 PM Original message: Original time 3 PM.");
  expect(messageSummary(corrected, [])).toContain("The original message is no longer in the retained history");
  const event = { kind: "clarification.resolve", clarification: { messageId: original.id, question: "Which time?" } };
  expect(workflowEventSummary(event, [original])).toContain("About the message: Original time 3 PM");
  expect(workflowEventSummary(event, [])).toContain("The original message is no longer in the retained history");
});
