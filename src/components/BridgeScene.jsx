import { useEffect, useRef, useState } from 'react';
import './bridgeScene.css';
import { PRINT_INKS } from '../lib/printPalette.js';
import { resolveColor, subscribeTheme } from '../lib/theme.js';

/*
 * "The space between us": two sculpted hands reaching for each other, printed in the page's inks.
 * Decorative only, never a tracked hand, a prediction or a sign demonstration.
 */

// Finger curls from 0 (straight) to 1 (fist). One hand reaches with a straight index finger, the
// other answers more loosely, like two people meeting halfway.
const REACHING = { index: 0, middle: 0.55, ring: 0.65, pinky: 0.7 };
const ANSWERING = { index: 0.14, middle: 0.45, ring: 0.55, pinky: 0.6 };
const HAND_SCALE = 1.2;
const SLEEVE_LENGTH = 6;
// Palm turned down and away from the viewer, so the backs of the hands and the nails show.
const PALM_DOWN = 2;
// Where the two index fingertips meet: a little above the middle, clear of the caption below.
const MEET_Y = 0.2;

function SceneFallback() {
  return (
    <svg className="bridge-scene__fallback" viewBox="0 0 480 360" fill="none" focusable="false">
      <ellipse cx="243" cy="186" rx="143" ry="128" stroke="currentColor" opacity=".2" />
      <ellipse cx="243" cy="186" rx="168" ry="92" stroke="currentColor" opacity=".12" transform="rotate(-28 243 186)" />
      <circle cx="366" cy="145" r="5" fill="var(--bridge-accent, #c89a6e)" />
      <circle cx="112" cy="230" r="3" fill="var(--bridge-accent, #c89a6e)" />
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
        const [THREE, { loadHandTemplate }, { createHandModelBones }, { FINGER_SPECS }, { FINGER_CURL_GAINS, thumbAnglesFor }, print] = await Promise.all([
          import('three'),
          import('../lib/handModelLoader.js'),
          import('../lib/handModelRig.js'),
          import('../lib/handSkinMesh.js'),
          import('../lib/handPoseSpec.js'),
          import('../lib/halftoneShader.js'),
        ]);
        if (disposed) return;
        // Without the hand model there is no sculpture: the SVG stand-in stays.
        const template = await loadHandTemplate(THREE);
        if (disposed) {
          template.geometry.dispose();
          return;
        }
        const handGeometry = own(template.geometry);

        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(pixelRatio);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        renderer.domElement.className = 'bridge-scene__canvas';
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.addEventListener('webglcontextlost', onContextLost);
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-3.1, 3.1, 2.5, -2.5, 0.1, 30);
        camera.position.set(0, 0, 9);
        scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3b2a20, 2.4));
        const keyLight = new THREE.DirectionalLight(0xfff1e2, 3.2);
        keyLight.position.set(-3, 5, 6);
        scene.add(keyLight);
        const sculpture = new THREE.Group();
        scene.add(sculpture);

        // Skin and nails are printed as halftone; sleeves, trims and satellites are flat spot colours.
        const uniforms = print.createPrintUniforms(THREE, { cell: 5, pixelRatio });
        const skinMaterial = own(new THREE.MeshStandardMaterial({ color: 0xf0e2d3, vertexColors: true, roughness: 0.55, metalness: 0 }));
        const nailMaterial = own(new THREE.MeshStandardMaterial({ color: 0xfbf3ea, roughness: 0.3, metalness: 0 }));
        print.printAsHalftone(skinMaterial, uniforms);
        print.printAsHalftone(nailMaterial, uniforms);
        const flat = (options = {}) => own(new THREE.MeshBasicMaterial({ toneMapped: false, ...options }));
        const sleeveMaterials = [flat({ side: THREE.DoubleSide }), flat({ side: THREE.DoubleSide })];
        const trimMaterial = flat();
        const accentMaterial = flat();
        const sphereGeometry = own(new THREE.SphereGeometry(1, 16, 12));
        const sleeveGeometry = own(new THREE.CylinderGeometry(1, 1.07, 1, 40, 1, true));
        const trimGeometry = own(new THREE.TorusGeometry(1, 0.05, 10, 48));

        const makeHand = (mirrorX, sleeveMaterial) => {
          const root = new THREE.Group(); // tilt in the picture plane, and where the hand sits
          const turn = new THREE.Group(); // palm down, fingers toward the middle
          const body = new THREE.Group(); // the model is a left hand; a negative X scale makes a right one
          body.scale.set(mirrorX * HAND_SCALE, HAND_SCALE, HAND_SCALE);
          root.add(turn);
          turn.add(body);
          const bones = createHandModelBones(THREE, template);
          body.add(bones[template.wrist]);
          for (const nail of template.nails) {
            const plate = new THREE.Mesh(sphereGeometry, nailMaterial);
            plate.position.copy(nail.position);
            plate.quaternion.copy(nail.quaternion);
            plate.scale.set(...nail.scale);
            bones[nail.joint].add(plate);
          }
          // The model ends in an open wrist; a long sleeve runs from just above it out of the frame.
          const { cuff } = template;
          const top = cuff.y + 0.1;
          const radiusX = cuff.radiusX * 1.17;
          const radiusZ = cuff.radiusZ * 1.2;
          const sleeve = new THREE.Mesh(sleeveGeometry, sleeveMaterial);
          sleeve.position.set(cuff.x, top - SLEEVE_LENGTH / 2, cuff.z);
          sleeve.scale.set(radiusX, SLEEVE_LENGTH, radiusZ);
          const trim = new THREE.Mesh(trimGeometry, trimMaterial);
          trim.position.set(cuff.x, top, cuff.z);
          trim.rotation.x = Math.PI / 2;
          trim.scale.set(radiusX, radiusZ, radiusX);
          // Both hands share one geometry; each binds it to its own skeleton.
          const skin = new THREE.SkinnedMesh(handGeometry, skinMaterial);
          skin.frustumCulled = false;
          body.add(sleeve, trim, skin);
          sculpture.add(root);
          root.updateMatrixWorld(true);
          skin.bind(own(new THREE.Skeleton(bones)));
          return {
            root,
            turn,
            thumb: [template.thumb.cmc, template.thumb.mcp, template.thumb.ip].map((id) => bones[id]),
            fingers: FINGER_SPECS.map((spec) => {
              const ids = template.fingers[spec.name];
              return { name: spec.name, splay: spec.baseSplayZ, mcp: bones[ids.mcp], pip: bones[ids.pip], dip: bones[ids.dip] };
            }),
            tip: bones[template.landmarkJoints[8]], // index fingertip
          };
        };
        const answering = makeHand(1, sleeveMaterials[0]); // left hand, from the left
        const reaching = makeHand(-1, sleeveMaterials[1]); // right hand, from the right

        // The same joint conventions as the 3D sign stage (rotation.set(curl, 0, splay)).
        const [gainMcp, gainPip, gainDip] = FINGER_CURL_GAINS;
        const openThumb = thumbAnglesFor('open');
        const pose = (hand, curls, time, phase) => {
          hand.thumb[0].rotation.set(...openThumb.cmc);
          hand.thumb[1].rotation.set(...openThumb.mcp);
          hand.thumb[2].rotation.set(...openThumb.ip);
          hand.fingers.forEach((finger, i) => {
            // Resting fingers are never quite still; the pointing index finger holds.
            const drift = finger.name === 'index' ? 0 : Math.sin(time * 0.9 + phase + i * 0.8) * 0.035;
            const curl = Math.max(0, curls[finger.name] + drift);
            const relax = 1 - curl;
            finger.mcp.rotation.set(curl * gainMcp + relax * 0.02, 0, finger.splay * (1 - curl * 0.7));
            finger.pip.rotation.set(curl * gainPip + relax * 0.06, 0, 0);
            finger.dip.rotation.set(curl * gainDip + relax * 0.04, 0, 0);
          });
        };
        const tip = new THREE.Vector3();
        // Moves a hand so its index fingertip lands on (x, y, z) in sculpture space.
        const placeTip = (hand, x, y, z) => {
          hand.tip.getWorldPosition(tip);
          sculpture.worldToLocal(tip);
          hand.root.position.set(x - tip.x, y - tip.y, z - tip.z);
        };

        const orbitMaterial = own(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.32, toneMapped: false }));
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
        [[-2.05, 1.4, -0.6], [2.05, 1.55, -0.6], [1.35, -1.75, -0.6]].forEach(([x, y, z], i) => {
          const node = new THREE.Mesh(sphereGeometry, accentMaterial);
          node.position.set(x, y, z);
          node.scale.setScalar(i === 1 ? 0.09 : 0.045);
          satellites.add(node);
        });
        scene.add(satellites);

        const recolor = () => {
          print.readPrintInks(THREE, host, uniforms);
          sleeveMaterials[0].color.setStyle(resolveColor(host, '--bridge-sleeve-a', PRINT_INKS.spot1));
          sleeveMaterials[1].color.setStyle(resolveColor(host, '--bridge-sleeve-b', PRINT_INKS.spot3));
          trimMaterial.color.setStyle(resolveColor(host, '--bridge-trim', PRINT_INKS.paperWhite));
          accentMaterial.color.setStyle(resolveColor(host, '--bridge-accent', PRINT_INKS.spot2));
          orbitMaterial.color.setStyle(resolveColor(host, '--bridge-orbit', PRINT_INKS.ink));
        };
        recolor();
        unsubscribeTheme = subscribeTheme(() => { recolor(); sync(); });

        draw = (time) => {
          // The fingertips drift closer and apart again, never quite touching.
          const gap = 0.14 + (1 + Math.sin(time * 0.5)) * 0.09;
          const lift = Math.sin(time * 0.42) * 0.03;
          sculpture.rotation.y = Math.sin(time * 0.21) * 0.08;
          pose(answering, ANSWERING, time, 1.7);
          pose(reaching, REACHING, time, 0);
          // One diagonal: up from the lower left, down from the upper right, so only the index
          // fingers meet and the resting fingers stay clear of each other.
          answering.root.rotation.z = 0.22;
          reaching.root.rotation.z = 0.22;
          answering.turn.rotation.set(PALM_DOWN + Math.sin(time * 0.33 + 1) * 0.05, 0, -Math.PI / 2);
          reaching.turn.rotation.set(PALM_DOWN + Math.sin(time * 0.37) * 0.05, 0, Math.PI / 2);
          answering.root.position.set(0, 0, 0);
          reaching.root.position.set(0, 0, 0);
          sculpture.updateMatrixWorld(true);
          placeTip(answering, -gap / 2, MEET_Y + lift - 0.1, 0.4);
          placeTip(reaching, gap / 2, MEET_Y + lift + 0.1, 0.4);
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
