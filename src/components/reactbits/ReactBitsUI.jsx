import { useEffect, useRef, useState } from "react";

/**
 * React Bits — DecryptedText
 * Animates text changes with a quick cyber character scramble reveal.
 */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
export function DecryptedText({ text = "", speed = 24, className = "" }) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (!text || import.meta.env?.MODE === "test") {
      setDisplay(text);
      return undefined;
    }
    let frame = 0;
    const total = Math.max(6, Math.min(18, text.length));
    const timer = window.setInterval(() => {
      frame += 1;
      const locked = Math.floor((frame / total) * text.length);
      if (frame >= total) {
        setDisplay(text);
        window.clearInterval(timer);
        return;
      }
      let next = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === " " || i < locked) {
          next += ch;
        } else {
          next += GLYPHS[(i * 7 + frame * 3) % GLYPHS.length];
        }
      }
      setDisplay(next);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed]);

  return <span className={"rb-decrypted " + className}>{display}</span>;
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
  spotlightColor = "rgba(58, 230, 168, 0.18)",
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
      el.style.setProperty("--spotlight-color", spotlightColor);
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
    if (el && import.meta.env?.MODE !== "test") {
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

/**
 * React Bits — AuroraParticles3D
 * Interactive Three.js background particle wave & aurora field that reacts to mouse and sign recognition.
 */
export function AuroraParticles3D({ active = false }) {
  const hostRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (import.meta.env?.MODE === "test") return undefined;
    const host = hostRef.current;
    if (!host || (typeof window.WebGLRenderingContext === "undefined" && typeof window.WebGL2RenderingContext === "undefined")) {
      return undefined;
    }
    let disposed = false;
    let renderer;
    let frameId = 0;
    const resources = new Set();
    const own = (r) => { resources.add(r); return r; };
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

    const onPointerMove = (e) => {
      mouse.tx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      mouse.ty = -((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const init = async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setClearColor(0x000000, 0);
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 40);
        camera.position.z = 8;

        // 160 floating interactive 3D particles
        const count = 160;
        const pos = new Float32Array(count * 3);
        const basePos = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const c1 = new THREE.Color(0x3ae6a8);
        const c2 = new THREE.Color(0x38bdf8);
        const c3 = new THREE.Color(0xffbe55);

        for (let i = 0; i < count; i++) {
          const x = (Math.random() - 0.5) * 18;
          const y = (Math.random() - 0.5) * 11;
          const z = (Math.random() - 0.5) * 5;
          pos[i * 3] = basePos[i * 3] = x;
          pos[i * 3 + 1] = basePos[i * 3 + 1] = y;
          pos[i * 3 + 2] = basePos[i * 3 + 2] = z;

          const pick = i % 5 === 0 ? c3 : i % 2 === 0 ? c1 : c2;
          colors[i * 3] = pick.r;
          colors[i * 3 + 1] = pick.g;
          colors[i * 3 + 2] = pick.b;
        }

        const geo = own(new THREE.BufferGeometry());
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const mat = own(new THREE.PointsMaterial({
          size: 0.065,
          vertexColors: true,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
        }));

        const points = new THREE.Points(geo, mat);
        scene.add(points);

        const resize = () => {
          if (disposed || !renderer) return;
          const w = window.innerWidth;
          const h = Math.max(1, window.innerHeight);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        };
        window.addEventListener("resize", resize);
        resize();

        const tick = (now) => {
          if (disposed) return;
          const t = now * 0.0006;
          mouse.x += (mouse.tx - mouse.x) * 0.06;
          mouse.y += (mouse.ty - mouse.y) * 0.06;

          const boost = activeRef.current ? 1.8 : 1.0;
          for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const bx = basePos[i3];
            const by = basePos[i3 + 1];
            pos[i3] = bx + Math.sin(t + i * 0.3) * 0.25 * boost + mouse.x * 0.45;
            pos[i3 + 1] = by + Math.cos(t * 1.2 + i * 0.25) * 0.25 * boost + mouse.y * 0.35;
          }
          geo.attributes.position.needsUpdate = true;
          points.rotation.z = mouse.x * 0.04;
          mat.size = activeRef.current ? 0.088 : 0.062;
          renderer.render(scene, camera);
          frameId = window.requestAnimationFrame(tick);
        };
        frameId = window.requestAnimationFrame(tick);

        return () => window.removeEventListener("resize", resize);
      } catch {
        return undefined;
      }
    };

    init();

    return () => {
      disposed = true;
      window.removeEventListener("pointermove", onPointerMove);
      if (frameId) window.cancelAnimationFrame(frameId);
      resources.forEach((r) => r.dispose?.());
      resources.clear();
      if (renderer) {
        renderer.dispose?.();
        renderer.forceContextLoss?.();
        renderer.domElement?.remove?.();
      }
    };
  }, []);

  return (
    <div className="rb-aurora-bg" aria-hidden="true">
      <div className="rb-aurora-glow rb-aurora-1" />
      <div className="rb-aurora-glow rb-aurora-2" />
      <div className="rb-aurora-glow rb-aurora-3" />
      <div ref={hostRef} className="rb-aurora-canvas" />
    </div>
  );
}
