/**
 * Halftone print pass for Three.js lit materials (MeshStandardMaterial, MeshPhysicalMaterial).
 *
 * The lit colour is reprinted as two dot screens on paper-white: a spot ink for the half-tones and a
 * dark ink for the deep shadows, with grazing angles inked like a drawn outline. Dots are sized in
 * screen pixels so they stay round at any zoom. The pass is spliced in after the material's output
 * colour conversion, where gl_FragColor is already sRGB, so the ink uniforms are sRGB components.
 *
 * The inks come from the page: --print-paper, --print-spot and --print-ink (src/styles/halftone.css).
 *
 * With the print pass off, the same splice can add "skin glow": a warm scatter at the silhouette and
 * fingertips, the cheap stand-in for light travelling under real skin.
 */
import { PRINT_INKS } from "./printPalette.js";
import { resolveColor } from "./theme.js";

const GLSL_HEAD = `
uniform float uHalftone;
uniform float uSkinGlow;
uniform float uHtCell;
uniform vec3 uHtPaper;
uniform vec3 uHtSpot;
uniform vec3 uHtInk;
float htDot(vec2 frag, float angle, float tone) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 cellPos = mat2(c, s, -s, c) * frag / uHtCell;
  float d = length(fract(cellPos) - 0.5);
  float r = 0.5 * sqrt(clamp(tone, 0.0, 1.0)) * 1.18;
  float aa = max(fwidth(d), 0.02);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}
`;

const GLSL_BODY = `
if (uHalftone > 0.5) {
  // Print shading needs form more than realism: a fixed key light from the upper right (view space)
  // gives every finger a lit side and a shadow side, and the real lighting adds creases and folds.
  vec3 n = normalize(normal);
  float key = clamp(dot(n, normalize(vec3(0.45, 0.55, 0.7))), 0.0, 1.0);
  float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float tone = clamp((1.0 - key) * 0.85 + (1.0 - lum) * 0.7, 0.0, 1.0);
  // Grazing angles are inked like a drawn outline. Normals are in view space here, and an
  // orthographic camera looks straight down -Z everywhere on screen.
  vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  float rim = 1.0 - abs(dot(n, viewDir));
  float spot = htDot(gl_FragCoord.xy, 0.2618, smoothstep(0.1, 0.62, tone));
  float ink = htDot(gl_FragCoord.xy, 0.7854, max(smoothstep(0.58, 0.95, tone), smoothstep(0.42, 0.8, rim) * 0.9));
  vec3 printed = uHtPaper;
  printed = mix(printed, printed * uHtSpot, spot);
  printed = mix(printed, printed * uHtInk, ink);
  gl_FragColor.rgb = printed;
} else if (uSkinGlow > 0.0) {
  // Real skin is translucent: light scattered under the surface warms the edges and fingertips.
  vec3 n = normalize(normal);
  vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  float edge = pow(1.0 - abs(dot(n, viewDir)), 2.2);
  gl_FragColor.rgb += uSkinGlow * edge * vec3(0.32, 0.08, 0.04);
}
`;

const toSrgb = (THREE, color) => {
  const { r, g, b } = color.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return new THREE.Vector3(r, g, b);
};

/**
 * Uniforms for one scene's printed materials. Share one set between materials so a theme change or
 * the on/off switch reaches all of them. `cell` is the dot spacing in CSS pixels.
 */
export function createPrintUniforms(THREE, { cell = 5.5, pixelRatio = 1, enabled = true, skinGlow = 0 } = {}) {
  return {
    uHalftone: { value: enabled ? 1 : 0 },
    uSkinGlow: { value: skinGlow },
    uHtCell: { value: cell * pixelRatio },
    uHtPaper: { value: toSrgb(THREE, new THREE.Color(PRINT_INKS.paperWhite)) },
    uHtSpot: { value: toSrgb(THREE, new THREE.Color(PRINT_INKS.spot2)) },
    uHtInk: { value: toSrgb(THREE, new THREE.Color(PRINT_INKS.ink)) },
  };
}

/** Splices the print pass into a built-in lit material. */
export function printAsHalftone(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${GLSL_HEAD}\nvoid main() {`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${GLSL_BODY}`);
  };
}

/** Re-reads the three print inks from CSS for the element's current theme. */
export function readPrintInks(THREE, element, uniforms) {
  const color = new THREE.Color();
  const read = (uniform, token, fallback) => {
    color.setStyle(resolveColor(element, token, fallback));
    const { r, g, b } = color.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    uniform.value.set(r, g, b);
  };
  read(uniforms.uHtPaper, "--print-paper", PRINT_INKS.paperWhite);
  read(uniforms.uHtSpot, "--print-spot", PRINT_INKS.spot2);
  read(uniforms.uHtInk, "--print-ink", PRINT_INKS.ink);
}
