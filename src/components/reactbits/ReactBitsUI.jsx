import { useRef, useState } from "react";

/**
 * React Bits — DecryptedText (print edition)
 * A changed word lands like a rubber stamp. Keyed by the text so every new word stamps once;
 * the CSS animation is switched off for reduced motion. (The old `speed` prop is ignored.)
 */
export function DecryptedText({ text = "", className = "" }) {
  return <span key={text} className={"rb-decrypted ht-stamp " + className}>{text}</span>;
}

/**
 * React Bits — ShinyText
 * Sweeping metallic shimmer across badges and kickers.
 */
export function ShinyText({ children, className = "" }) {
  return <span className={"rb-shiny-text " + className}>{children}</span>;
}

/**
 * React Bits — GradientText
 * Animated multi-stop aurora gradient typography.
 */
export function GradientText({ children, className = "" }) {
  return <span className={"rb-gradient-text " + className}>{children}</span>;
}

/**
 * React Bits — SpotlightCard
 * Tracks cursor position to render a radial spotlight glow across dark glass cards.
 */
export function SpotlightCard({
  as: Tag = "div",
  children,
  className = "",
  spotlightColor = "",
  onMouseMove,
  ...rest
}) {
  const ref = useRef(null);

  const handleMove = (e) => {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
      el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
      if (spotlightColor) el.style.setProperty("--spotlight-color", spotlightColor);
    }
    onMouseMove?.(e);
  };

  return (
    <Tag ref={ref} className={"rb-spotlight-card " + className} onMouseMove={handleMove} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * React Bits — TiltedCard
 * Interactive 3D perspective tilt + cursor glare on hover.
 */
export function TiltedCard({
  as: Tag = "button",
  children,
  className = "",
  maxTilt = 9,
  scale = 1.025,
  onMouseMove,
  onMouseLeave,
  ...rest
}) {
  const ref = useRef(null);

  const handleMove = (e) => {
    const el = ref.current;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (el && import.meta.env?.MODE !== "test" && !still) {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const xc = rect.width * 0.5;
      const yc = rect.height * 0.5;
      const rotX = ((y - yc) / Math.max(1, yc)) * -maxTilt;
      const rotY = ((x - xc) / Math.max(1, xc)) * maxTilt;
      el.style.transform = `perspective(700px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale3d(${scale}, ${scale}, ${scale})`;
      el.style.setProperty("--mouse-x", `${x}px`);
      el.style.setProperty("--mouse-y", `${y}px`);
    }
    onMouseMove?.(e);
  };

  const handleLeave = (e) => {
    const el = ref.current;
    if (el) {
      el.style.transform = "";
    }
    onMouseLeave?.(e);
  };

  return (
    <Tag
      ref={ref}
      className={"rb-tilted-card rb-spotlight-card " + className}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * React Bits — Magnet
 * Gently pulls interactive elements toward the user's cursor.
 */
export function Magnet({ children, strength = 0.22, className = "" }) {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el || import.meta.env?.MODE === "test") return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - (rect.left + rect.width * 0.5)) * strength;
    const dy = (e.clientY - (rect.top + rect.height * 0.5)) * strength;
    el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  };

  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <span ref={ref} className={"rb-magnet " + className} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </span>
  );
}

/**
 * React Bits — Floating Magnification Dock
 * Gaussian proximity scaling dock for quick sign & navigation actions.
 */
export function ReactBitsDock({ items = [] }) {
  const [mouseX, setMouseX] = useState(null);
  const itemRefs = useRef([]);

  if (import.meta.env?.MODE === "test" || !items.length) return null;

  return (
    <div
      className="rb-dock-wrap"
      aria-hidden="true"
      onMouseMove={(e) => setMouseX(e.clientX)}
      onMouseLeave={() => setMouseX(null)}
    >
      <div className="rb-dock">
        {items.map((item, idx) => {
          let scale = 1;
          const el = itemRefs.current[idx];
          if (mouseX !== null && el) {
            const rect = el.getBoundingClientRect();
            const center = rect.left + rect.width * 0.5;
            const dist = Math.abs(mouseX - center);
            scale = 1 + 0.42 * Math.exp(-Math.pow(dist / 78, 2));
          }
          return (
            <button
              key={item.id}
              ref={(node) => { itemRefs.current[idx] = node; }}
              type="button"
              tabIndex={-1}
              className={"rb-dock-item" + (item.active ? " is-active" : "")}
              style={{ transform: `scale(${scale.toFixed(3)}) translateY(${((1 - scale) * 10).toFixed(1)}px)` }}
              onClick={item.onClick}
              title={item.label}
            >
              <span className="rb-dock-icon">{item.icon}</span>
              <span className="rb-dock-tooltip">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
