// Draws the detected hand skeletons (the real landmarks) over the camera view.
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export function drawHands(canvas, hands, width, height) {
  if (!canvas || !width || !height) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  const line = Math.max(2, width / 220);
  ctx.lineWidth = line;
  ctx.lineCap = "round";
  for (const hand of hands) {
    const pts = hand.landmarks.map((p) => [p.x * width, p.y * height]);
    ctx.strokeStyle = "rgba(56, 200, 255, 0.9)";
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
    }
    ctx.stroke();
    ctx.fillStyle = "#00e08a";
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, line * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
