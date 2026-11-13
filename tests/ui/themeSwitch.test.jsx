import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import ThemeSwitch from "../../src/components/ThemeSwitch.jsx";
import { applyThemeChoice, getThemeChoice, resolveColor, setThemeChoice, subscribeTheme } from "../../src/lib/theme.js";

const option = (name) => screen.getByRole("button", { name });
const pressed = () => screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent);

beforeEach(() => {
  window.localStorage.clear();
  act(() => setThemeChoice("auto"));
});
afterEach(() => {
  cleanup();
  act(() => setThemeChoice("auto"));
});

test("Paper and Ink pin the theme for the whole page and are remembered; Auto hands it back to the system", () => {
  render(<ThemeSwitch />);
  expect(screen.getByRole("group", { name: "Colour theme" })).toBeTruthy();
  expect(pressed()).toEqual(["Auto"]);
  expect(document.documentElement.dataset.theme).toBeUndefined();

  fireEvent.click(option("Ink"));
  expect(pressed()).toEqual(["Ink"]);
  expect(document.documentElement.dataset.theme).toBe("ink");
  expect(JSON.parse(window.localStorage.getItem("signbridge:theme"))).toBe("ink");

  fireEvent.click(option("Paper"));
  expect(document.documentElement.dataset.theme).toBe("paper");

  fireEvent.click(option("Auto"));
  expect(pressed()).toEqual(["Auto"]);
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(JSON.parse(window.localStorage.getItem("signbridge:theme"))).toBe("auto");
});

test("every switch on screen shows the same choice", () => {
  render(<><ThemeSwitch /><ThemeSwitch /></>);
  fireEvent.click(screen.getAllByRole("button", { name: "Ink" })[0]);
  expect(pressed()).toEqual(["Ink", "Ink"]);
});

test("a saved choice is applied before the first paint, and unknown choices are ignored", () => {
  act(() => setThemeChoice("paper"));
  applyThemeChoice();
  expect(document.documentElement.dataset.theme).toBe("paper");
  expect(getThemeChoice()).toBe("paper");

  act(() => setThemeChoice("sepia"));
  expect(getThemeChoice()).toBe("paper"); // unknown choices are ignored
});

test("canvases hear about theme changes and get a usable colour even where CSS cannot answer", () => {
  let changes = 0;
  const unsubscribe = subscribeTheme(() => { changes += 1; });
  act(() => setThemeChoice("ink"));
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    expect(changes).toBeGreaterThan(0); // MutationObserver on <html data-theme>
    unsubscribe();
    const before = changes;
    act(() => setThemeChoice("paper"));
    return new Promise((done) => setTimeout(done, 0)).then(() => {
      expect(changes).toBe(before);
      // jsdom does not compute light-dark() tokens; the fallback keeps canvases drawing.
      const el = document.createElement("canvas");
      document.body.append(el);
      const resolved = resolveColor(el, "--tangerine", "rgb(255, 106, 44)");
      expect(resolved).toMatch(/^rgba?\(/);
      expect(el.style.color).toBe("");
      el.remove();
    });
  });
});
