import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import SignVideoPlayer from "../../src/components/SignVideoPlayer.jsx";

const clip = (label, n) => ({ id: label, label, signLanguage: "isl", textLanguage: "en", blob: new Blob([String(n)], { type: "video/mp4" }) });
let playCalls;
beforeEach(() => {
  playCalls = [];
  let id = 0;
  URL.createObjectURL = vi.fn(() => `blob:clip-${++id}`);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () { playCalls.push(this.getAttribute("src")); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(cleanup);

test("advancing uses the next clip, never replays the old source under a new word", async () => {
  render(<SignVideoPlayer text="alpha beta" clips={[clip("alpha", 1), clip("beta", 2)]} signLanguage="isl" textLanguage="en" autoPlay />);
  await act(async () => {});
  const first = screen.getByLabelText("Sign video: alpha");
  const firstSrc = first.getAttribute("src");
  playCalls = [];
  fireEvent.ended(first);
  await act(async () => {});
  const second = screen.getByLabelText("Sign video: beta");
  expect(second.getAttribute("src")).not.toBe(firstSrc);
  expect(playCalls).not.toContain(firstSrc);
});

test("repeated words restart the same clip from the beginning", async () => {
  render(<SignVideoPlayer text="alpha alpha" clips={[clip("alpha", 1)]} signLanguage="isl" textLanguage="en" autoPlay />);
  await act(async () => {});
  const first = screen.getByLabelText("Sign video: alpha");
  first.currentTime = 8;
  fireEvent.ended(first);
  await act(async () => {});
  expect(screen.getByLabelText("Sign video: alpha").currentTime).toBe(0);
});

test("missing words remain visible and stop playback until explicitly advanced", async () => {
  render(<SignVideoPlayer text="alpha missing beta" clips={[clip("alpha", 1), clip("beta", 2)]} signLanguage="isl" textLanguage="en" autoPlay />);
  await act(async () => {});
  fireEvent.ended(screen.getByLabelText("Sign video: alpha"));
  await act(async () => {});
  expect(screen.getByText("Video missing — read this word as text.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play", exact: true }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Play", exact: true }).disabled).toBe(false);
});
