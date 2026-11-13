/**
 * The print palette as JavaScript sees it.
 *
 * CSS owns the colours: the :root block of src/styles/halftone.css, read at runtime through
 * resolveColor(). These values are only what JS falls back to where CSS cannot answer: WebGL
 * materials before the first theme read, jsdom tests, and the browser chrome and PWA manifest.
 * Keep them in step with that block when the palette changes.
 */
export const PRINT_INKS = Object.freeze({
  ink: "#3b2a20", // --sticker-ink, and --ink on Paper: espresso
  paperWhite: "#fffaf3", // --paper-white
  spot1: "#7b5034", // coffee: actions, positive states
  spot2: "#c89a6e", // caramel: halftones, highlights
  spot3: "#e9c07a", // honey: holding a sign, stickers
});

/** Browser toolbar and PWA colours for the two stocks (--stock-paper, --stock-ink). */
export const BROWSER_CHROME = Object.freeze({ paper: "#f3ebe0", ink: "#1c1512" });

/**
 * One colour per finger (thumb, index, middle, ring, pinky) for the camera skeleton and the 3D joint
 * markers. These are instruments drawn over skin and camera images, so they stay light, cool and
 * distinct whatever the page palette is.
 */
export const FINGER_INKS = Object.freeze(["#ffd86b", "#b9a6ff", "#ff9e85", "#ff7fa8", "#8fd3ff"]);

/** Light text with a dark outline, for labels drawn over the camera image. */
export const CAMERA_LABEL = Object.freeze({ fill: "#f3ebe0", outline: "#1a1310" });
