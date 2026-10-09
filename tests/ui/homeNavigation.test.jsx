import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Home from "../../src/modes/Home.jsx";

const action = (label) => screen.getByRole("button", {
  name: (name) => name.startsWith(label),
});
const moreTools = () => screen.getByText("More tools", { selector: "summary" }).closest("details");
const setup = (shell) => {
  const onPick = vi.fn();
  render(<Home onPick={onPick} shell={shell} />);
  return onPick;
};

beforeEach(() => { window.history.replaceState(null, "", "#home"); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "#"); });

test.each([
  ["Sign to text & voice", "trained-sign"],
  ["Speak with AI", "voice"],
])("%s is usable without expanding More tools and opens its screen", (label, route) => {
  const onPick = setup();
  const details = moreTools(), button = action(label);
  expect(details.open).toBe(false);
  expect(button.closest("details")).toBeNull();
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(onPick).toHaveBeenCalledExactlyOnceWith(route);
  expect(details.open).toBe(false);
});

test("More tools starts closed, expands for each remaining tool, and can close again", () => {
  const onPick = setup();
  const details = moreTools(), summary = within(details).getByText("More tools", { selector: "summary" });
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  for (const label of ["Training Studio", "Saved sign videos", "Experimental video practice"]) {
    const button = action(label);
    expect(button.closest("details")).toBe(details);
    fireEvent.click(button);
  }
  expect(onPick.mock.calls).toEqual([["training-studio"], ["sign-videos"], ["live-sign"]]);
  fireEvent.click(summary);
  expect(details.open).toBe(false);
});

test("Start conversation opens the shared conversation screen", () => {
  const onPick = setup();
  const button = action("Start conversation");
  expect(button.closest("details")).toBeNull();
  fireEvent.click(button);
  expect(onPick).toHaveBeenCalledExactlyOnceWith("connect");
});

test("Join conversation retains the join hint after normal route navigation", () => {
  const onPick = vi.fn((route) => { window.history.replaceState(null, "", `#${route}`); });
  render(<Home onPick={onPick} />);
  fireEvent.click(action("Join conversation"));
  expect(onPick).toHaveBeenCalledExactlyOnceWith("connect");
  expect(window.location.hash).toBe("#connect?action=join");
});

test("Talk to AI with signs is visible and opens the existing sign screen with an AI purpose hint", () => {
  const onPick = vi.fn((route) => { window.history.replaceState(null, "", `#${route}`); });
  render(<Home onPick={onPick} />);
  const entry = action("Talk to AI with signs");
  expect(entry.closest("details")).toBeNull();
  expect(entry.textContent).toMatch(/reviewed text only when you send/i);
  fireEvent.click(entry);
  expect(onPick).toHaveBeenCalledExactlyOnceWith("trained-sign");
  expect(window.location.hash).toBe("#trained-sign?with=ai");
});

test("Communication preferences stays directly available and opens Connect", () => {
  const onPick = setup();
  const button = action("Communication preferences");
  expect(button.closest("details")).toBeNull();
  fireEvent.click(button);
  expect(onPick).toHaveBeenCalledExactlyOnceWith("connect");
});

test("Home plainly discloses experimental isolated-word recognition and unvalidated translation", () => {
  setup();
  const copy = action("Sign to text & voice").textContent;
  expect(copy).toMatch(/experimental\s+isolated[- ]word/i);
  expect(copy).toMatch(/translation\s+is\s+not\s+validated/i);
  expect(copy).toMatch(/review\s+every\s+result/i);
});

test("an unavailable installation prompt does not show an install action", () => {
  const install = vi.fn();
  setup({ canInstall: false, install });
  expect(screen.queryByRole("button", { name: "Install SignBridge" })).toBeNull();
  expect(install).not.toHaveBeenCalled();
});

test("available installation keeps the shell callback and does not navigate", () => {
  const install = vi.fn(), onPick = setup({ canInstall: true, install });
  fireEvent.click(action("Install SignBridge"));
  expect(install).toHaveBeenCalledOnce();
  expect(onPick).not.toHaveBeenCalled();
  expect(moreTools().open).toBe(false);
});

test("iOS installation guidance still explains Share and Add to Home Screen", () => {
  setup({ iosHint: true, canInstall: false });
  expect(screen.getByText(/Install on iPhone or iPad/)).toBeTruthy();
  expect(screen.getByText("Share", { selector: "strong" })).toBeTruthy();
  expect(screen.getByText("Add to Home Screen", { selector: "strong" })).toBeTruthy();
});
