import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import BridgeScene from '../../src/components/BridgeScene.jsx';

const graphics = vi.hoisted(() => ({ instances: [], unavailable: false }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  // Exercise actual Three scene/geometry ownership; jsdom has no GPU renderer.
  class WebGLRenderer {
    constructor() {
      if (graphics.unavailable) throw new Error('WebGL is unavailable');
      this.domElement = document.createElement('canvas');
      this.setPixelRatio = vi.fn();
      this.setClearColor = vi.fn();
      this.setSize = vi.fn();
      this.render = vi.fn();
      this.dispose = vi.fn();
      this.forceContextLoss = vi.fn();
      graphics.instances.push(this);
    }
  }
  return { ...actual, WebGLRenderer };
});
// The real sculpted hand, read straight from the asset: jsdom cannot fetch it for GLTFLoader.
vi.mock('../../src/lib/handModelLoader.js', async () => {
  const path = await import('node:path');
  const { prepareHandModel } = await import('../../src/lib/handModelRig.js');
  const { readHandModelData } = await import('../helpers/handModel.js');
  // jsdom gives import.meta.url an http: URL, so resolve from the project root the tests run in.
  const data = readHandModelData(path.resolve('public/hand3d/left.glb'));
  let template = null;
  return {
    loadHandTemplate: async (THREE) => {
      template ??= prepareHandModel(THREE, data);
      return { ...template, geometry: template.geometry.clone() };
    },
  };
});

let frames;
let nextFrame;
let viewport;
let size;
let motion;
let hidden;
let bounds;

beforeEach(() => {
  graphics.instances.length = 0;
  graphics.unavailable = false;
  frames = new Map();
  nextFrame = 0;
  viewport = [];
  size = [];
  hidden = false;
  bounds = { width: 480, height: 360 };
  motion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('WebGL2RenderingContext', class {});
  vi.stubGlobal('matchMedia', vi.fn(() => motion));
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); size.push(this); }
    observe() {}
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); viewport.push(this); }
    observe() {}
  });
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => bounds);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function initialized(element = <BridgeScene />) {
  const view = render(element);
  await waitFor(() => expect(graphics.instances).toHaveLength(1));
  return { ...view, renderer: graphics.instances[0] };
}

const show = () => act(() => viewport[0].callback([{ isIntersecting: true }]));

test('platforms without a WebGL API keep the illustration without initializing graphics', async () => {
  vi.stubGlobal('WebGLRenderingContext', undefined);
  vi.stubGlobal('WebGL2RenderingContext', undefined);
  const { container } = render(<BridgeScene />);
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(graphics.instances).toHaveLength(0);
  expect(frames.size).toBe(0);
  expect(viewport).toHaveLength(0);
  expect(size).toHaveLength(0);
  expect(container.querySelector('.bridge-scene__fallback')).not.toBeNull();
  expect(container.querySelector('canvas')).toBeNull();
});

test('decorative rendering suspends for camera use, reduced motion, hidden tabs and unavailable viewport', async () => {
  const { rerender, renderer, container } = await initialized();
  expect(renderer.render).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  show();
  expect(renderer.render).toHaveBeenCalledOnce();
  expect(frames.size).toBe(1);
  expect(container.firstElementChild.getAttribute('aria-hidden')).toBe('true');

  rerender(<BridgeScene paused />);
  expect(frames.size).toBe(0);
  rerender(<BridgeScene />);
  expect(frames.size).toBe(1);

  act(() => { motion.matches = true; motion.dispatchEvent(new Event('change')); });
  expect(frames.size).toBe(0);
  act(() => { motion.matches = false; motion.dispatchEvent(new Event('change')); });
  expect(frames.size).toBe(1);

  const renderedBeforeHide = renderer.render.mock.calls.length;
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  expect(frames.size).toBe(0);
  expect(renderer.render).toHaveBeenCalledTimes(renderedBeforeHide);
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  expect(frames.size).toBe(1);

  act(() => { bounds = { width: 0, height: 0 }; size[0].callback(); });
  expect(frames.size).toBe(0);
  act(() => { bounds = { width: 480, height: 360 }; size[0].callback(); });
  expect(frames.size).toBe(1);
  act(() => viewport[0].callback([{ isIntersecting: false }]));
  expect(frames.size).toBe(0);
});

test('unmount releases every scene resource and callback', async () => {
  const { unmount, renderer, container } = await initialized();
  show();
  const scene = renderer.render.mock.calls[0][0];
  const resources = new Set();
  scene.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    if (object.material) resources.add(object.material);
    if (object.isInstancedMesh) resources.add(object);
  });
  const releases = [...resources].map((resource) => {
    const released = vi.fn();
    resource.addEventListener('dispose', released);
    return released;
  });
  expect(container.querySelectorAll('canvas')).toHaveLength(1);
  unmount();
  releases.forEach((released) => expect(released).toHaveBeenCalledOnce());
  expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(size[0].disconnect).toHaveBeenCalledOnce();
  expect(viewport[0].disconnect).toHaveBeenCalledOnce();
  expect(container.querySelector('canvas')).toBeNull();
  const count = renderer.render.mock.calls.length;
  act(() => {
    motion.dispatchEvent(new Event('change'));
    document.dispatchEvent(new Event('visibilitychange'));
    size[0].callback();
    viewport[0].callback([{ isIntersecting: true }]);
  });
  expect(renderer.render).toHaveBeenCalledTimes(count);
});

test('unmount before the lazy import settles never creates a renderer or frame loop', async () => {
  const { unmount } = render(<BridgeScene />);
  unmount();
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(graphics.instances).toHaveLength(0);
  expect(frames.size).toBe(0);
});

test('WebGL failure keeps the fallback and a lost context releases the renderer immediately', async () => {
  graphics.unavailable = true;
  const failed = render(<BridgeScene />);
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(failed.container.querySelector('.bridge-scene__fallback')).not.toBeNull();
  expect(failed.container.querySelector('.bridge-scene--ready')).toBeNull();
  expect(failed.container.querySelector('canvas')).toBeNull();
  expect(frames.size).toBe(0);
  failed.unmount();

  graphics.unavailable = false;
  const { renderer, container, unmount } = await initialized();
  show();
  expect(container.querySelector('.bridge-scene--ready')).not.toBeNull();
  act(() => renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  expect(container.querySelector('.bridge-scene--ready')).toBeNull();
  expect(container.querySelector('canvas')).toBeNull();
  expect(frames.size).toBe(0);
  expect(renderer.dispose).toHaveBeenCalledOnce();
  unmount();
  expect(renderer.dispose).toHaveBeenCalledOnce();
});
