import { useEffect, useRef } from "react";
import { PATTERNS, SCREEN_ANGLES, buildScreen, coverageAt, dotRadius } from "../lib/halftone.js";
import { PRINT_INKS } from "../lib/printPalette.js";
import { resolveColor, resolvedTheme, subscribeTheme } from "../lib/theme.js";

const TAU = Math.PI * 2;
const FALLBACK_INKS = { "--spot-1": PRINT_INKS.spot1, "--spot-2": PRINT_INKS.spot2, "--spot-3": PRINT_INKS.spot3, "--ink": PRINT_INKS.ink };
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * A live halftone print: dots whose size carries the tone, one screen per ink, the second ink
 * overprinted (multiply on paper, screen on ink). Decorative only.
 *
 * It follows the same manners as BridgeScene: draws nothing while hidden, off-screen or empty,
 * keeps a single still frame for reduced motion or `animate={false}` (use that while the camera
 * runs, so recognition keeps the CPU), and redraws in the new inks when the theme changes.
 */
export default function HalftoneField({
  pattern = "sun",
  inks = ["--spot-2", "--spot-1"],
  cell = 10,
  fps = 30,
  energy = 1,
  animate = true,
  interactive = false,
  className = "",
}) {
  const canvasRef = useRef(null);
  const settings = useRef({});
  settings.current = { pattern, inks, cell, fps, energy, animate, interactive };
  const syncRef = useRef(null);

  // Prop changes (state-driven energy, camera pausing, other inks) restart or stop the loop in place.
  const inkKey = inks.join(",");
  useEffect(() => {
    syncRef.current?.({ reprint: true });
  }, [pattern, inkKey, cell, fps, energy, animate, interactive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || import.meta.env?.MODE === "test") return undefined;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return undefined;

    let disposed = false;
    let frame = 0;
    let lastFrameAt = 0;
    let time = 0;
    let printStartedAt = 0;
    let printed = false;
    let width = 0;
    let height = 0;
    let screens = [];
    let screensFor = "";
    let colors = [];
    let inView = !("IntersectionObserver" in window);
    let dark = false;
    const pointer = { u: 0.5, v: 0.5, strength: 0, target: 0, tu: 0.5, tv: 0.5 };
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const readInks = () => {
      dark = resolvedTheme() === "ink";
      colors = settings.current.inks.map((token) => resolveColor(canvas, token, FALLBACK_INKS[token] || PRINT_INKS.spot2));
    };
    const ensureScreens = () => {
      const key = `${width}x${height}@${settings.current.cell}`;
      if (key === screensFor) return;
      screensFor = key;
      screens = SCREEN_ANGLES.map((angle) => buildScreen(width, height, settings.current.cell, angle));
    };

    const draw = (now) => {
      const { pattern: name, energy: power, cell: size } = settings.current;
      const fieldFor = PATTERNS[name] || PATTERNS.sun;
      ensureScreens();
      // The first print grows its dots in from nothing, the way ink takes on a press.
      const still = motion?.matches || !settings.current.animate;
      if (!printStartedAt) printStartedAt = now;
      const grow = still || printed ? 1 : easeOut(Math.min(1, (now - printStartedAt) / 900));
      if (grow >= 1) printed = true;
      pointer.u += (pointer.tu - pointer.u) * 0.18;
      pointer.v += (pointer.tv - pointer.v) * 0.18;
      pointer.strength += (pointer.target - pointer.strength) * 0.12;
      const scene = { aspect: width / height, energy: power, pointer: settings.current.interactive ? pointer : null };

      const dpr = canvas.width / Math.max(1, width);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      colors.forEach((color, ink) => {
        const screen = screens[ink];
        if (!screen) return;
        ctx.globalCompositeOperation = ink === 0 ? "source-over" : dark ? "screen" : "multiply";
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < screen.length; i += 4) {
          const coverage = coverageAt(fieldFor, screen[i + 2], screen[i + 3], time, ink, scene) * grow;
          if (coverage < 0.006) continue;
          const r = dotRadius(coverage, size);
          ctx.moveTo(screen[i] + r, screen[i + 1]);
          ctx.arc(screen[i], screen[i + 1], r, 0, TAU);
        }
        ctx.fill();
      });
    };

    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrameAt = 0;
    };
    const canAnimate = () =>
      !disposed && inView && !document.hidden && !motion?.matches && settings.current.animate && width > 0 && height > 0;
    const loop = (now) => {
      frame = 0;
      if (!canAnimate()) return;
      if (!lastFrameAt || now - lastFrameAt >= 1000 / settings.current.fps) {
        time += lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 0.1) : 0;
        lastFrameAt = now;
        draw(now);
      }
      frame = window.requestAnimationFrame(loop);
    };
    const sync = ({ reprint = false } = {}) => {
      stop();
      if (disposed || !inView || document.hidden || !width || !height) return;
      if (reprint) readInks();
      draw(performance.now());
      if (canAnimate()) frame = window.requestAnimationFrame(loop);
    };
    syncRef.current = sync;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = Math.max(0, Math.round(box.width));
      height = Math.max(0, Math.round(box.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      sync();
    };

    const host = canvas.parentElement;
    const onPointerMove = (event) => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      pointer.tu = (event.clientX - box.left) / box.width;
      pointer.tv = (event.clientY - box.top) / box.height;
      pointer.target = 1;
    };
    const onPointerLeave = () => { pointer.target = 0; };
    host?.addEventListener("pointermove", onPointerMove, { passive: true });
    host?.addEventListener("pointerleave", onPointerLeave);

    const visibility = () => sync();
    document.addEventListener("visibilitychange", visibility);
    motion?.addEventListener?.("change", visibility);
    const unsubscribeTheme = subscribeTheme(() => sync({ reprint: true }));

    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);
    const intersectionObserver = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { threshold: 0.01 })
      : null;
    intersectionObserver?.observe(canvas);

    readInks();
    resize();

    return () => {
      disposed = true;
      stop();
      if (syncRef.current === sync) syncRef.current = null;
      host?.removeEventListener("pointermove", onPointerMove);
      host?.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", visibility);
      motion?.removeEventListener?.("change", visibility);
      unsubscribeTheme();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={`halftone-field ${className}`} aria-hidden="true" />;
}
