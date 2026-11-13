import { HAND_MODEL_URL, extractHandModelData, prepareHandModel } from "./handModelRig.js";

let request = null;

/**
 * Loads and prepares the sculpted hand model (public/hand3d) once per page, however many scenes show
 * it. Each caller gets its own copy of the geometry, so a scene that disposes its GPU buffers on
 * unmount never pulls the model out from under another. A failed load is retried on the next call.
 */
export async function loadHandTemplate(THREE) {
  request ??= (async () => {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL || "/"}${HAND_MODEL_URL}`);
    return prepareHandModel(THREE, extractHandModelData(THREE, gltf.scene));
  })().catch((error) => {
    request = null;
    throw error;
  });
  const template = await request;
  return { ...template, geometry: template.geometry.clone() };
}
