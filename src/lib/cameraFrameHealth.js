/** A tiny sampled image can reveal a uniformly dark feed, not its hardware cause.
 * "visible" only means the sample is not uniformly dark; it does not assess signing.
 */
export function analyzeCameraFrame(image) {
  const { data, width, height } = image || {};
  const count = width * height;
  if (!Number.isSafeInteger(count) || count < 1 || count > 4096 || !data || data.length !== count * 4) return "unknown";
  let sum = 0, squares = 0, minimum = 255, maximum = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const [red, green, blue, alpha] = [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
    if (![red, green, blue, alpha].every((value) => Number.isFinite(value) && value >= 0 && value <= 255) || alpha !== 255) return "unknown";
    const light = (77 * red + 150 * green + 29 * blue) / 256;
    sum += light; squares += light * light;
    minimum = Math.min(minimum, light); maximum = Math.max(maximum, light);
  }
  const mean = sum / count, variance = Math.max(0, squares / count - mean * mean);
  return mean <= 35 && variance <= 4 && maximum - minimum <= 8 ? "dark" : "visible";
}
