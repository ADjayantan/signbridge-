/**
 * Colour theme: "paper" (light print) or "ink" (dark print), or "auto" to follow the system.
 *
 * CSS does the real work: every colour token is a light-dark() pair, and <html data-theme>
 * pins the colour scheme when the person picks one. Canvases and WebGL scenes cannot read
 * light-dark() tokens directly, so they resolve them here and re-read them on a theme change.
 */
import { load, save } from "./storage.js";

export const THEME_CHOICES = Object.freeze(["auto", "paper", "ink"]);
const STORAGE_KEY = "theme";
const listeners = new Set();
let current = null;

/** Browser chrome colour per theme (address bar, task switcher). Matches --paper. */
const BROWSER_CHROME = { paper: "#f6f0e8", ink: "#15111c" };

export function getThemeChoice() {
  if (current) return current;
  const saved = load(STORAGE_KEY, "auto");
  current = THEME_CHOICES.includes(saved) ? saved : "auto";
  return current;
}

/** Writes the choice onto <html>. "auto" removes the attribute so the system preference decides. */
export function applyThemeChoice(choice = getThemeChoice()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "paper" || choice === "ink") root.dataset.theme = choice;
  else delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute("content", BROWSER_CHROME[resolvedTheme()]);
}

export function setThemeChoice(choice) {
  if (!THEME_CHOICES.includes(choice)) return;
  current = choice;
  save(STORAGE_KEY, choice);
  applyThemeChoice(choice);
  listeners.forEach((listener) => listener());
}

/** For useSyncExternalStore: notified when the person changes the choice. */
export function subscribeThemeChoice(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The theme actually on screen right now. */
export function resolvedTheme() {
  if (typeof document === "undefined") return "paper";
  const pinned = document.documentElement.dataset.theme;
  if (pinned === "paper" || pinned === "ink") return pinned;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "ink" : "paper";
}

/**
 * Calls `onChange` whenever the visible theme may have changed: a new choice, or the system
 * switching between light and dark while on "auto". Returns the unsubscribe function.
 */
export function subscribeTheme(onChange) {
  if (typeof document === "undefined") return () => {};
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", onChange);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media?.removeEventListener?.("change", onChange);
    observer?.disconnect();
  };
}

/**
 * Resolves a colour token as it applies at `element` (light-dark() and local overrides included)
 * by letting the browser compute it into the element's own `color`. The element's inline colour
 * is restored before the browser can paint. Falls back when nothing usable comes back.
 */
export function resolveColor(element, token, fallback) {
  if (!element?.style || typeof getComputedStyle !== "function") return fallback;
  const previous = element.style.color;
  try {
    element.style.color = token.startsWith("--") ? `var(${token})` : token;
    const resolved = getComputedStyle(element).color;
    return /^rgba?\(/.test(resolved) ? resolved : fallback;
  } catch {
    return fallback;
  } finally {
    element.style.color = previous;
  }
}
