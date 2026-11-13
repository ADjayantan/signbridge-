import { useEffect, useRef, useState } from 'react';
import './bridgeScene.css';
import { resolveColor, subscribeTheme } from '../lib/theme.js';

// An abstract sculpture, never a tracked hand, prediction or sign demonstration.
const LANDMARKS = [
  [0, -1.18, 0],
  [-0.42, -0.73, 0.05], [-0.76, -0.33, 0.15], [-1.02, 0.01, 0.31], [-1.23, 0.32, 0.43],
  [-0.38, -0.08, 0], [-0.44, 0.56, 0.02], [-0.48, 1.07, 0.19], [-0.47, 1.46, 0.35],
  [0.03, 0, -0.04], [0.06, 0.76, 0.02], [0.08, 1.31, 0.15], [0.09, 1.72, 0.34],
  [0.4, -0.06, 0], [0.54, 0.61, 0.09], [0.63, 1.11, 0.24], [0.66, 1.48, 0.4],
  [0.69, -0.24, 0.09], [0.95, 0.25, 0.19], [1.09, 0.67, 0.38], [1.16, 0.96, 0.56],
];
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

function SceneFallback() {
  return (
    <svg className="bridge-scene__fallback" viewBox="0 0 480 360" fill="none" focusable="false">
      <ellipse cx="243" cy="186" rx="143" ry="128" stroke="currentColor" opacity=".2" />
      <ellipse cx="243" cy="186" rx="168" ry="92" stroke="currentColor" opacity=".12" transform="rotate(-28 243 186)" />
      <g transform="translate(225 205) scale(66 -66) rotate(15)">
        {CONNECTIONS.map(([a, b]) => <line key={`${a}-${b}`} x1={LANDMARKS[a][0]} y1={LANDMARKS[a][1]} x2={LANDMARKS[b][0]} y2={LANDMARKS[b][1]} stroke="currentColor" strokeWidth=".045" />)}
        {LANDMARKS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 0 ? '.105' : '.065'} fill="currentColor" />)}
      </g>
      <circle cx="366" cy="145" r="5" fill="var(--bridge-accent, #ff6a2c)" />
      <circle cx="112" cy="230" r="3" fill="var(--bridge-accent, #ff6a2c)" />
    </svg>
  );
}

/** Decorative WebGL only. Pause it while camera/recognition resources are in use. */
export default function BridgeScene({ paused = false, className = '' }) {
  const hostRef = useRef(null);
  const pausedRef = useRef(paused);
  const syncRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    syncRef.current?.();
  }, [paused]);

  useEffect(() => {
    const host = hostRef.current;
    // Skip even loading Three on platforms with no WebGL API. A present API can
    // still deny a context, which the renderer's fallback path handles below.
    if (!host || (typeof window.WebGLRenderingContext === 'undefined'
      && typeof window.WebGL2RenderingContext === 'undefined')) return;
    let disposed = false;
    let renderer;
    let frame = 0;
    let inView = false;
    let contextLost = false;
    let resizeObserver;
    let intersectionObserver;
    let unsubscribeTheme = () => {};
    let draw = () => {};
    let lastFrameAt = 0;
    let elapsed = 0;
    let width = 0;
    let height = 0;
    let revealed = false;
    const resources = new Set();
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const own = (resource) => { resources.add(resource); return resource; };
    const releaseGraphics = () => {
      resources.forEach((resource) => resource.dispose());
      resources.clear();
      if (!renderer) return;
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      renderer = undefined;
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrameAt = 0;
    };
    const canAnimate = () => !disposed && !contextLost && !!renderer && inView
      && !document.hidden && !motion?.matches && !pausedRef.current && width > 0 && height > 0;
    const animate = (at) => {
      frame = 0;
      if (!canAnimate()) return;
      // A quiet decorative scene needs at most 30 renders per second.
      if (!lastFrameAt || at - lastFrameAt >= 1000 / 30) {
        elapsed += lastFrameAt ? Math.min((at - lastFrameAt) / 1000, 0.1) : 0;
        lastFrameAt = at;
        draw(elapsed);
      }
      frame = window.requestAnimationFrame(animate);
    };
    const sync = () => {
      stop();
      if (disposed || contextLost || !renderer || !inView || document.hidden || !width || !height) return;
      // Reduced motion and paused states retain a single still image.
      draw(elapsed);
      if (canAnimate()) frame = window.requestAnimationFrame(animate);
    };
    syncRef.current = sync;
    const onContextLost = (event) => {
      event.preventDefault();
      contextLost = true;
      stop();
      releaseGraphics();
      if (!disposed) setReady(false);
    };
    document.addEventListener('visibilitychange', sync);
    motion?.addEventListener?.('change', sync);

    const initialize = async () => {
      try {
        const THREE = await import('three');
        if (disposed) return;
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.25;
        renderer.domElement.className = 'bridge-scene__canvas';
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.addEventListener('webglcontextlost', onContextLost);
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-3.1, 3.1, 2.5, -2.5, 0.1, 30);
        camera.position.set(0, 0, 9);
        scene.add(new THREE.HemisphereLight(0xfff4df, 0x1b1d33, 3.2));
        const keyLight = new THREE.DirectionalLight(0xffeee1, 4);
        keyLight.position.set(-3, 5, 6);
        scene.add(keyLight);
        const sculpture = new THREE.Group();
        scene.add(sculpture);

        const nodeGeometry = own(new THREE.SphereGeometry(1, 12, 10));
        const boneGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 8));
        const nodeMaterial = own(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 }));
        const boneMaterial = own(new THREE.MeshStandardMaterial({ color: 0x17182a, roughness: 0.55, metalness: 0.1 }));
        const copperMaterial = own(new THREE.MeshStandardMaterial({ color: 0xff6a2c, roughness: 0.5, metalness: 0.15 }));
        const transform = new THREE.Object3D();
        const up = new THREE.Vector3(0, 1, 0);
        // Print inks, read from CSS so the sculpture follows Paper / Ink and dark camera plates.
        const teal = new THREE.Color(0x2e49d6);
        const copper = new THREE.Color(0xff6a2c);
        const handNodes = [];

        const makeHand = (secondary) => {
          const hand = new THREE.Group();
          const points = LANDMARKS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
          const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, points.length);
          points.forEach((point, index) => {
            transform.position.copy(point);
            transform.rotation.set(0, 0, 0);
            transform.scale.setScalar(index === 0 ? 0.105 : (index % 4 === 0 ? 0.075 : 0.06));
            transform.updateMatrix();
            nodes.setMatrixAt(index, transform.matrix);
            nodes.setColorAt(index, index % 4 === 0 || secondary ? copper : teal);
          });
          const bones = new THREE.InstancedMesh(boneGeometry, secondary ? copperMaterial : boneMaterial, CONNECTIONS.length);
          CONNECTIONS.forEach(([a, b], index) => {
            const direction = new THREE.Vector3().subVectors(points[b], points[a]);
            transform.position.copy(points[a]).add(points[b]).multiplyScalar(0.5);
            transform.quaternion.setFromUnitVectors(up, direction.clone().normalize());
            transform.scale.set(0.022, direction.length(), 0.022);
            transform.updateMatrix();
            bones.setMatrixAt(index, transform.matrix);
          });
          nodes.instanceMatrix.needsUpdate = true;
          nodes.instanceColor.needsUpdate = true;
          handNodes.push({ nodes, secondary, count: points.length });
          bones.instanceMatrix.needsUpdate = true;
          // Instancing owns GPU buffers in addition to the shared geometry.
          own(nodes);
          own(bones);
          hand.add(nodes, bones);
          return hand;
        };

        const front = makeHand(false);
        front.position.set(-0.32, -0.05, 0.35);
        front.rotation.set(-0.18, -0.33, -0.28);
        const back = makeHand(true);
        back.position.set(0.86, -0.36, -0.8);
        back.rotation.set(0.18, Math.PI + 0.2, 0.35);
        back.scale.setScalar(0.72);
        sculpture.add(back, front);

        const orbitMaterial = own(new THREE.LineBasicMaterial({ color: 0x17182a, transparent: true, opacity: 0.32 }));
        const orbit = new THREE.Group();
        [0, 1].forEach((index) => {
          const points = [];
          for (let i = 0; i <= 96; i += 1) {
            const angle = i / 96 * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(angle) * (2.02 + index * 0.23), Math.sin(angle) * (2.02 + index * 0.23), 0));
          }
          const geometry = own(new THREE.BufferGeometry().setFromPoints(points));
          const ring = new THREE.LineLoop(geometry, orbitMaterial);
          ring.rotation.set(index ? 0.7 : 0.15, index ? -0.65 : 0.15, index ? -0.3 : 0);
          orbit.add(ring);
        });
        orbit.position.z = -0.9;
        scene.add(orbit);
        const satellites = new THREE.Group();
        [[-2.1, 0.65, 0], [1.96, 0.9, -0.1], [1.32, -1.8, 0]].forEach((position, i) => {
          const node = new THREE.Mesh(nodeGeometry, copperMaterial);
          node.position.set(...position);
          node.scale.setScalar(i === 1 ? 0.09 : 0.045);
          satellites.add(node);
        });
        scene.add(satellites);

        const recolor = () => {
          teal.setStyle(resolveColor(host, '--bridge-node', 'rgb(46, 73, 214)'));
          copper.setStyle(resolveColor(host, '--bridge-accent', 'rgb(255, 106, 44)'));
          boneMaterial.color.setStyle(resolveColor(host, '--bridge-bone', 'rgb(23, 24, 42)'));
          copperMaterial.color.copy(copper);
          orbitMaterial.color.setStyle(resolveColor(host, '--bridge-orbit', 'rgb(23, 24, 42)'));
          handNodes.forEach(({ nodes, secondary, count }) => {
            for (let index = 0; index < count; index += 1) nodes.setColorAt(index, index % 4 === 0 || secondary ? copper : teal);
            nodes.instanceColor.needsUpdate = true;
          });
        };
        recolor();
        unsubscribeTheme = subscribeTheme(() => { recolor(); sync(); });

        draw = (time) => {
          sculpture.rotation.y = Math.sin(time * 0.23) * 0.11;
          sculpture.position.y = Math.sin(time * 0.45) * 0.055;
          orbit.rotation.z = time * 0.015;
          satellites.rotation.z = Math.sin(time * 0.15) * 0.04;
          renderer.render(scene, camera);
          if (!revealed) {
            revealed = true;
            setReady(true);
          }
        };
        const resize = () => {
          if (disposed || contextLost) return;
          const bounds = host.getBoundingClientRect();
          width = Math.max(0, Math.round(bounds.width));
          height = Math.max(0, Math.round(bounds.height));
          if (width && height) {
            const aspect = width / height;
            const halfHeight = Math.max(2.45, 2.5 / aspect);
            camera.left = -halfHeight * aspect;
            camera.right = halfHeight * aspect;
            camera.top = halfHeight;
            camera.bottom = -halfHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height, false);
          }
          sync();
        };
        if ('ResizeObserver' in window) {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(host);
        } else {
          window.addEventListener('resize', resize);
          resizeObserver = { disconnect: () => window.removeEventListener('resize', resize) };
        }
        if ('IntersectionObserver' in window) {
          intersectionObserver = new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            sync();
          }, { threshold: 0.01 });
          intersectionObserver.observe(host);
        } else {
          inView = true;
        }
        resize();
      } catch {
        stop();
        contextLost = true;
        releaseGraphics();
        if (!disposed) setReady(false);
      }
    };
    initialize();

    return () => {
      disposed = true;
      stop();
      if (syncRef.current === sync) syncRef.current = null;
      document.removeEventListener('visibilitychange', sync);
      motion?.removeEventListener?.('change', sync);
      unsubscribeTheme();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      releaseGraphics();
    };
  }, []);

  return (
    <div ref={hostRef} className={`bridge-scene ${ready ? 'bridge-scene--ready' : ''} ${className}`} aria-hidden="true">
      <SceneFallback />
      <span className="bridge-scene__halo" />
    </div>
  );
}
