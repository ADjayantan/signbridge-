import React, { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../src/App.jsx";
import { DEFAULT_SETTINGS } from "../../src/hooks/useSettings.js";

const state = vi.hoisted(() => ({ connectEntries: [] }));
vi.mock("../../src/hooks/useSettings.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, useSettings: () => [real.DEFAULT_SETTINGS, vi.fn()] };
});
vi.mock("../../src/hooks/useAppShell.js", () => ({ useAppShell: () => ({ online: true, canInstall: false }) }));
vi.mock("../../src/modes/TrainedSignMode.jsx", () => ({ default: ({ initialDestination, onConnect, onBack }) => {
  const [text, setText] = useState("");
  return <main><p>Selected purpose: {initialDestination}</p><label>Local reviewed message<textarea value={text} onChange={(event) => setText(event.target.value)} /></label><button onClick={() => onConnect(text)}>Open partner room</button><button onClick={onBack}>Home from sign</button></main>;
} }));
vi.mock("../../src/modes/ConnectMode.jsx", () => ({ default: ({ initialReviewedText, onReviewedTextConsumed, onTool, onBack, settings }) => {
  const [incoming] = useState(initialReviewedText);
  useEffect(() => { state.connectEntries.push({ text: initialReviewedText, settings }); if (initialReviewedText) onReviewedTextConsumed(); }, []);
  return <main><p>Room input: {incoming || "empty"}</p><button onClick={() => onTool("trained-sign")}>Open local sign tool</button><button onClick={onBack}>Home from room</button></main>;
} }));

beforeEach(() => { state.connectEntries = []; window.history.replaceState(null, "", "#home"); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "#home"); });

test("Home's explicit sign-AI entry routes to the existing sign tool with AI selected", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Talk to AI with signs/ }));
  expect(window.location.hash).toBe("#trained-sign?with=ai");
  expect(screen.getByText("Selected purpose: ai")).toBeTruthy();
  expect(state.connectEntries).toEqual([]);
});

test.each([["ai", "ai"], ["partner", "local"], ["unknown", "local"]])("a bookmarked sign-tool purpose '%s' resolves only the supported local or AI state", (hint, expected) => {
  window.history.replaceState(null, "", `#trained-sign?with=${hint}`); render(<App />);
  expect(screen.getByText(`Selected purpose: ${expected}`)).toBeTruthy();
  expect(state.connectEntries).toEqual([]);
});

test("reviewed local text moves to a human room once, and the consumed seed is not replayed on a later room entry", () => {
  window.history.replaceState(null, "", "#trained-sign"); render(<App />);
  const text = "  Please give me time.\nI am signing.  ";
  fireEvent.change(screen.getByLabelText("Local reviewed message"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Open partner room" }));
  expect(window.location.hash).toBe("#connect");
  expect(state.connectEntries).toEqual([{ text, settings: DEFAULT_SETTINGS }]);
  fireEvent.click(screen.getByRole("button", { name: "Open local sign tool" }));
  expect(screen.getByText("Selected purpose: local")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open partner room" }));
  expect(state.connectEntries.at(-1).text).toBeNull();
});
