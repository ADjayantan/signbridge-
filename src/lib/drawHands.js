// Draws only the detected, complete hand skeletons over the camera view.
import { HAND_CONNECTIONS, HAND_FINGERS, HAND_JOINT_NAMES, isCompleteHandLandmarks } from "./handJoints.js";
const TIP_JOINTS = new Set([4, 8, 12, 16, 20]);
const fingerFor = (joint) => HAND_FINGERS.find((finger) => finger.joints.includes(joint));

export function drawHands(canvas, hands, width, height, { showLabels = false, showJointNumbers = false, mirrorText = false } = {}) {
  if (!canvas || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  let ctx;
  try { ctx = canvas.getContext("2d"); } catch { return; }
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const line = Math.max(2, width / 220);
  ctx.lineWidth = line;
  ctx.lineCap = "round";
  const fontSize = Math.max(11, width / 58);
  for (const hand of Array.isArray(hands) ? hands : []) {
    if (!isCompleteHandLandmarks(hand?.landmarks)) continue;
    const pts = hand.landmarks.map((p) => [p.x * width, p.y * height]);
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.strokeStyle = fingerFor(a === 0 ? b : a)?.color || "#56c8ff";
      ctx.beginPath();
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
      ctx.stroke();
    }
    pts.forEach(([x, y], joint) => {
      const tip = TIP_JOINTS.has(joint);
      ctx.fillStyle = joint === 0 ? "#ffffff" : fingerFor(joint)?.color || "#00e08a";
      ctx.beginPath();
      ctx.arc(x, y, line * (joint === 0 ? 2.2 : tip ? 1.9 : 1.35), 0, Math.PI * 2);
      ctx.fill();
      if ((!showLabels || (!tip && joint !== 0)) && !showJointNumbers) return;
      const name = showLabels && (tip || joint === 0) ? `${joint === 0 && hand.handedness ? `${hand.handedness} ` : ""}${HAND_JOINT_NAMES[joint]}` : "";
      const label = name ? `${name}${showJointNumbers ? ` (${joint})` : ""}` : String(joint);
      ctx.save();
      ctx.font = `600 ${fontSize}px sans-serif`; ctx.textBaseline = "middle";
      const labelWidth = ctx.measureText?.(label).width || label.length * fontSize * .6;
      // CSS mirrors the preview; counter-mirror text only so joint labels stay readable.
      const labelX = mirrorText ? Math.max(labelWidth + 3, Math.min(width - 3, x - line * 2)) : Math.max(3, Math.min(width - labelWidth - 3, x + line * 2));
      const labelY = Math.max(fontSize, Math.min(height - fontSize, y));
      ctx.translate(labelX, labelY);
      if (mirrorText) ctx.scale(-1, 1);
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#12202e"; ctx.lineWidth = 3;
      ctx.strokeText?.(label, 0, 0); ctx.fillText(label, 0, 0);
      ctx.restore();
    });
  }
}
