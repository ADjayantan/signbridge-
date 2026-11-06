import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCamera } from "../../src/hooks/useCamera.js";
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("camera permission resolving after unmount immediately releases every track", async () => {
  let resolve;
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => new Promise((r) => { resolve = r; }) } });
  const { unmount } = renderHook(() => useCamera({ active: true }));
  await act(async () => {});
  unmount();
  await act(async () => resolve({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce();
});

test("a connected camera becoming unavailable releases the stream and exposes retry", async () => {
  const track = Object.assign(new EventTarget(), { label: "Integrated Camera", stop: vi.fn() });
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { result } = renderHook(() => useCamera({ active: true })); await act(async () => {});
  act(() => track.dispatchEvent(new Event("ended")));
  expect(result.current.status).toBe("error"); expect(result.current.error).toMatch(/Camera disconnected/); expect(track.stop).toHaveBeenCalledOnce();
  await act(async () => result.current.retry()); expect(result.current.status).toBe("on"); expect(getUserMedia).toHaveBeenCalledTimes(2);
});

const cameraDevices = [
  { kind: "videoinput", deviceId: "phone", label: "Redmi Note 10 Pro Max (Windows Virtual Camera)" },
  { kind: "videoinput", deviceId: "integrated", label: "Integrated Camera" },
];
const cameraStream = (id) => {
  const track = { label: cameraDevices.find((d) => d.deviceId === id).label, stop: vi.fn(), getSettings: () => ({ deviceId: id }) };
  return { getTracks: () => [track], getVideoTracks: () => [track] };
};

test("automatically chooses the integrated laptop camera instead of the default virtual phone camera", async () => {
  const getUserMedia = vi.fn().mockImplementation(async (options) => cameraStream(options.video.deviceId?.exact || "phone"));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: async () => cameraDevices } });
  const { result } = renderHook(() => useCamera({ active: true })); await act(async () => {});
  expect(getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: "integrated" });
  expect(result.current.name).toBe("Integrated Camera");
});

test("rechecks camera labels after permission and releases the unwanted phone stream before switching", async () => {
  const phone = cameraStream("phone");
  const getUserMedia = vi.fn().mockResolvedValueOnce(phone).mockResolvedValue(cameraStream("integrated"));
  const enumerateDevices = vi.fn().mockResolvedValueOnce(cameraDevices.map((d) => ({ ...d, label: "" }))).mockResolvedValue(cameraDevices);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices } });
  const { result } = renderHook(() => useCamera({ active: true })); await act(async () => {});
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(phone.getTracks()[0].stop).toHaveBeenCalledOnce(); expect(result.current.name).toBe("Integrated Camera");
});

test("an explicit camera selection overrides automatic laptop-camera preference", async () => {
  const getUserMedia = vi.fn().mockImplementation(async (options) => cameraStream(options.video.deviceId?.exact || "integrated"));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: async () => cameraDevices } });
  const { result } = renderHook(() => useCamera({ active: true, deviceId: "phone" })); await act(async () => {});
  expect(getUserMedia).toHaveBeenCalledOnce(); expect(getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: "phone" });
  expect(result.current.name).toMatch(/Redmi/);
});

test("blocked camera permission reports recovery instructions and retry requests permission again", async () => {
  const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error(), { name: "NotAllowedError" }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { result } = renderHook(() => useCamera({ active: true }));
  await act(async () => {});
  expect(result.current.status).toBe("error");
  expect(result.current.error).toMatch(/Camera access is blocked/);
  await act(async () => result.current.retry());
  expect(getUserMedia).toHaveBeenCalledTimes(2);
});

test("default camera requests a front-facing video stream without a microphone and reports the connected device", async () => {
  const track = { label: "Integrated Camera", stop: vi.fn() };
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { result, rerender } = renderHook(({ active }) => useCamera({ active }), { initialProps: { active: true } });
  await act(async () => {});
  expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  expect(result.current.status).toBe("on");
  expect(result.current.name).toBe("Integrated Camera");
  rerender({ active: false });
  expect(result.current.status).toBe("off"); expect(result.current.name).toBe("");
  expect(track.stop).toHaveBeenCalledOnce();
});

test("widescreen is an ideal request and keeps integrated-camera preference even when the actual stream is 4:3", async () => {
  const stream = cameraStream("integrated");
  stream.getVideoTracks()[0].getSettings = () => ({ deviceId: "integrated", width: 640, height: 480 });
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: async () => cameraDevices } });
  const { result } = renderHook(() => useCamera({ active: true, preferredFormat: "widescreen" }));
  await act(async () => {});
  expect(getUserMedia).toHaveBeenCalledWith({
    video: { deviceId: { exact: "integrated" }, width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } }, audio: false,
  });
  expect(result.current.status).toBe("on");
  expect(result.current.name).toBe("Integrated Camera");
  expect(stream.getVideoTracks()[0].getSettings()).toMatchObject({ width: 640, height: 480 });
  expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
});

test("changing preferred format releases the previous stream and requests the new ideals", async () => {
  const original = cameraStream("integrated"), widescreen = cameraStream("integrated");
  const getUserMedia = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(widescreen);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { result, rerender, unmount } = renderHook(({ preferredFormat }) => useCamera({ active: true, preferredFormat }), { initialProps: { preferredFormat: "standard" } });
  await act(async () => {});
  await act(async () => rerender({ preferredFormat: "widescreen" }));
  expect(original.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(getUserMedia.mock.calls[0][0].video).toMatchObject({ width: { ideal: 640 }, height: { ideal: 480 } });
  expect(getUserMedia.mock.calls[0][0].video).not.toHaveProperty("aspectRatio");
  expect(getUserMedia.mock.calls[1][0].video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } });
  expect(result.current.status).toBe("on");
  expect(widescreen.getTracks()[0].stop).not.toHaveBeenCalled();
  unmount();
  expect(widescreen.getTracks()[0].stop).toHaveBeenCalledOnce();
});

test("permission from a superseded format request releases its stale stream without replacing the active stream", async () => {
  let resolveOriginal;
  const original = cameraStream("phone"), widescreen = cameraStream("integrated");
  const getUserMedia = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOriginal = resolve; })).mockResolvedValueOnce(widescreen);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { result, rerender } = renderHook(({ preferredFormat }) => useCamera({ active: true, preferredFormat }), { initialProps: { preferredFormat: "standard" } });
  await act(async () => {});
  await act(async () => rerender({ preferredFormat: "widescreen" }));
  expect(result.current.name).toBe("Integrated Camera");
  await act(async () => resolveOriginal(original));
  expect(original.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(widescreen.getTracks()[0].stop).not.toHaveBeenCalled();
  expect(result.current.status).toBe("on");
  expect(result.current.name).toBe("Integrated Camera");
});

test("choosing widescreen while inactive waits for explicit camera start", async () => {
  const getUserMedia = vi.fn().mockResolvedValue(cameraStream("integrated"));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { result, rerender } = renderHook((props) => useCamera(props), { initialProps: { active: false, preferredFormat: "standard" } });
  await act(async () => rerender({ active: false, preferredFormat: "widescreen" }));
  expect(getUserMedia).not.toHaveBeenCalled(); expect(result.current.status).toBe("off");
  await act(async () => rerender({ active: true, preferredFormat: "widescreen" }));
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(getUserMedia.mock.calls[0][0].video.aspectRatio).toEqual({ ideal: 16 / 9 });
});

test("denied widescreen permission retains clear recovery and never loops through camera formats", async () => {
  const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error(), { name: "NotAllowedError" }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { result } = renderHook(() => useCamera({ active: true, preferredFormat: "widescreen" }));
  await act(async () => {});
  expect(result.current.status).toBe("error"); expect(result.current.error).toMatch(/Camera access is blocked/);
  expect(getUserMedia).toHaveBeenCalledOnce();
  await act(async () => result.current.retry());
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(getUserMedia.mock.calls[1][0].video.aspectRatio).toEqual({ ideal: 16 / 9 });
});

const sampledFrame = (light) => ({ width: 32, height: 24, data: Uint8ClampedArray.from({ length: 32 * 24 * 4 }, (_, i) => i % 4 === 3 ? 255 : light) });

async function startSampledCamera(context) {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  const stream = cameraStream("integrated"), getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const hook = renderHook(({ active }) => useCamera({ active }), { initialProps: { active: false } });
  hook.result.current.videoRef.current = { readyState: 2, videoWidth: 640, videoHeight: 480, paused: false, ended: false, play: vi.fn().mockResolvedValue(), srcObject: null };
  await act(async () => hook.rerender({ active: true }));
  return { ...hook, stream, getUserMedia };
}

test("three consecutive uniformly dark samples report dark and a visible sample recovers without reopening camera", async () => {
  const context = { drawImage: vi.fn(), getImageData: vi.fn().mockReturnValue(sampledFrame(22)) };
  const { result, stream, getUserMedia } = await startSampledCamera(context);
  expect(result.current.frameHealth).toBe("unknown");
  act(() => vi.advanceTimersByTime(1000)); expect(result.current.frameHealth).toBe("unknown");
  act(() => vi.advanceTimersByTime(1000)); expect(result.current.frameHealth).toBe("dark");
  expect(result.current.status).toBe("on"); expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
  context.getImageData.mockReturnValue(sampledFrame(180));
  act(() => vi.advanceTimersByTime(1000)); expect(result.current.frameHealth).toBe("visible");
  expect(getUserMedia).toHaveBeenCalledOnce();
});

test("unreadable frames reset the dark streak and remain unknown", async () => {
  const context = { drawImage: vi.fn(), getImageData: vi.fn().mockReturnValue(sampledFrame(22)) };
  const { result } = await startSampledCamera(context);
  act(() => vi.advanceTimersByTime(1000));
  context.getImageData.mockImplementationOnce(() => { throw new Error("unreadable"); });
  act(() => vi.advanceTimersByTime(1000)); expect(result.current.frameHealth).toBe("unknown");
  act(() => vi.advanceTimersByTime(2000)); expect(result.current.frameHealth).toBe("unknown");
  act(() => vi.advanceTimersByTime(1000)); expect(result.current.frameHealth).toBe("dark");
});

test("turning the camera off clears health and stops frame inspection", async () => {
  const context = { drawImage: vi.fn(), getImageData: vi.fn().mockReturnValue(sampledFrame(22)) };
  const { result, rerender, stream } = await startSampledCamera(context);
  act(() => vi.advanceTimersByTime(2000)); expect(result.current.frameHealth).toBe("dark");
  act(() => rerender({ active: false })); expect(result.current.frameHealth).toBe("unknown");
  const inspected = context.getImageData.mock.calls.length;
  act(() => vi.advanceTimersByTime(5000)); expect(context.getImageData).toHaveBeenCalledTimes(inspected);
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
});
