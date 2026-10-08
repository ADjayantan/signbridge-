import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCamera } from "../../src/hooks/useCamera.js";
afterEach(cleanup);

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
