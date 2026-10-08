import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRoomMedia } from "../../src/hooks/useRoomMedia.js";

class FakeStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  addTrack(track) { this.tracks.push(track); }
}
function track(kind, deviceId = "integrated") {
  return Object.assign(new EventTarget(), { id: `${kind}_${deviceId}`, kind, label: "Integrated Camera", stop: vi.fn(), getSettings: () => ({ deviceId }) });
}
class FakePeer {
  static all = [];
  constructor(config) { this.config = config; this.transceivers = []; this.signalingState = "stable"; this.connectionState = "new"; this.close = vi.fn(); this.addIceCandidate = vi.fn().mockResolvedValue(); FakePeer.all.push(this); }
  addTransceiver(item, options) {
    const kind = typeof item === "string" ? item : item.kind;
    const sender = { track: typeof item === "string" ? null : item, replaceTrack: vi.fn().mockImplementation(async (next) => { sender.track = next; }) };
    const transceiver = { sender, receiver: { track: { kind } }, options }; this.transceivers.push(transceiver); return transceiver;
  }
  getTransceivers() { return this.transceivers; }
  async setLocalDescription() { this.localDescription = { type: this.remoteDescription?.type === "offer" ? "answer" : "offer", sdp: "test-sdp" }; this.signalingState = this.localDescription.type === "offer" ? "have-local-offer" : "stable"; }
  async setRemoteDescription(value) { this.remoteDescription = value; this.signalingState = value.type === "offer" ? "have-remote-offer" : "stable"; }
}
function roomState(overrides = {}) {
  let handler;
  const room = { roomId: "room1", participantId: "host", role: "host", status: "connected", participants: [{ id: "host", online: true }, { id: "guest", online: true }], sendSignal: vi.fn().mockReturnValue(true), getIceServers: vi.fn().mockResolvedValue({ iceServers: [{ urls: "stun:stun.example" }], relayAvailable: false }), subscribeSignal: vi.fn((fn) => { handler = fn; return () => { handler = null; }; }), ...overrides };
  return { room, signal: (data) => handler?.(data) };
}
beforeEach(() => { FakePeer.all = []; vi.stubGlobal("MediaStream", FakeStream); vi.stubGlobal("RTCPeerConnection", FakePeer); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("conversation initializes receive transceivers with camera/mic off and no media permissions", async () => {
  const getUserMedia = vi.fn(); Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  expect(getUserMedia).not.toHaveBeenCalled(); expect(result.current.cameraOn).toBe(false); expect(result.current.micOn).toBe(false); expect(result.current.remoteAudioEnabled).toBe(false);
  expect(FakePeer.all[0].transceivers.map((item) => item.options.direction)).toEqual(["sendrecv", "sendrecv"]);
  expect(result.current.mediaStatus).toBe("connecting"); expect(result.current.notice).toMatch(/relay is unavailable/);
  act(() => { FakePeer.all[0].connectionState = "connected"; FakePeer.all[0].onconnectionstatechange(); });
  expect(result.current.mediaStatus).toBe("connected");
});
test("camera is acquired once and the same physical track is shared with recognition and call", async () => {
  const video = track("video"); const getUserMedia = vi.fn().mockResolvedValue(new FakeStream([video]));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: async () => [{ kind: "videoinput", deviceId: "virtual", label: "OBS Virtual Camera" }, { kind: "videoinput", deviceId: "integrated", label: "Integrated Camera" }] } });
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  await act(async () => result.current.enableCamera());
  expect(getUserMedia).toHaveBeenCalledOnce(); expect(getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: "integrated" }); expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
  expect(result.current.localStream.getVideoTracks()[0]).toBe(video); expect(FakePeer.all[0].transceivers[0].sender.track).toBe(video);
  await act(async () => result.current.enableCamera()); expect(getUserMedia).toHaveBeenCalledOnce();
  act(() => result.current.disableCamera()); expect(video.stop).toHaveBeenCalledOnce(); expect(result.current.cameraOn).toBe(false); expect(FakePeer.all[0].transceivers[0].sender.track).toBe(null);
});
test("stop cancels an outstanding camera permission result and releases all late tracks", async () => {
  let resolve; const video = track("video");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => new Promise((done) => { resolve = done; }) } });
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  let pending; await act(async () => { pending = result.current.enableCamera(); });
  act(() => result.current.stop()); await act(async () => { resolve(new FakeStream([video])); await pending; });
  expect(video.stop).toHaveBeenCalledOnce(); expect(result.current.cameraOn).toBe(false); expect(result.current.localStream).toBe(null);
});
test("unmount cancels outstanding microphone permission and releases its late result", async () => {
  let resolve; const audio = track("audio");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => new Promise((done) => { resolve = done; }) } });
  const { room } = roomState(); const { result, unmount } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  let pending; await act(async () => { pending = result.current.enableMic(); }); unmount();
  await act(async () => { resolve(new FakeStream([audio])); await pending; }); expect(audio.stop).toHaveBeenCalledOnce();
});
test("denied camera does not alter connected room status or request microphone permission", async () => {
  const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => result.current.enableCamera());
  expect(result.current.cameraStatus).toBe("error"); expect(result.current.error).toMatch(/Typing still works/); expect(room.status).toBe("connected"); expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
});
test("ICE candidates before remote description wait until an offer has been applied", async () => {
  const { room, signal } = roomState({ role: "guest", participantId: "guest" }); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  const peer = FakePeer.all[0]; await act(async () => signal({ candidate: { candidate: "test" } })); expect(peer.addIceCandidate).not.toHaveBeenCalled();
  await act(async () => signal({ description: { type: "offer", sdp: "remote" } })); expect(peer.addIceCandidate).toHaveBeenCalledOnce(); expect(room.sendSignal).toHaveBeenCalledWith({ description: { type: "answer", sdp: "test-sdp" } }); expect(result.current.mediaStatus).toBe("connecting");
});
test("perfect negotiation ignores a colliding offer on the impolite host", async () => {
  const { room, signal } = roomState(); renderHook(() => useRoomMedia(room)); await act(async () => {}); const peer = FakePeer.all[0];
  await act(async () => peer.onnegotiationneeded()); await act(async () => signal({ description: { type: "offer", sdp: "collision" } }));
  expect(peer.remoteDescription).toBeUndefined(); expect(room.sendSignal).toHaveBeenCalledTimes(1);
});
test("force relay requires real TURN configuration and keeps text room usable", async () => {
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  await act(async () => result.current.setForceRelay(true)); expect(result.current.error).toMatch(/requires TURN/); expect(result.current.mediaStatus).toBe("error"); expect(room.status).toBe("connected");
});
test("actual TURN credentials set relay transport policy", async () => {
  const { room } = roomState({ getIceServers: vi.fn().mockResolvedValue({ iceServers: [{ urls: "turn:relay.example", username: "u", credential: "c" }], relayAvailable: true }) });
  const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {}); await act(async () => result.current.setForceRelay(true));
  expect(FakePeer.all.at(-1).config.iceTransportPolicy).toBe("relay");
});
test("signaling disconnect closes the old peer, preserves owned camera and reconnect creates fresh peer", async () => {
  const video = track("video"); Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(new FakeStream([video])) } });
  const { room } = roomState(); const { result, rerender } = renderHook(({ current }) => useRoomMedia(current), { initialProps: { current: room } }); await act(async () => result.current.enableCamera()); const first = FakePeer.all[0];
  rerender({ current: { ...room, status: "reconnecting" } }); expect(first.close).toHaveBeenCalledOnce(); expect(video.stop).not.toHaveBeenCalled(); expect(result.current.mediaStatus).toBe("reconnecting");
  rerender({ current: room }); await act(async () => {}); expect(FakePeer.all).toHaveLength(2); expect(FakePeer.all[1].transceivers[0].sender.track).toBe(video);
  rerender({ current: { ...room, status: "ended" } }); expect(video.stop).toHaveBeenCalledOnce(); expect(result.current.cameraOn).toBe(false); expect(result.current.localStream).toBe(null);
});
test("pending ICE fetch after a partner leaves cannot create a stale peer", async () => {
  let resolve; const { room } = roomState({ getIceServers: () => new Promise((done) => { resolve = done; }) });
  const { rerender } = renderHook(({ current }) => useRoomMedia(current), { initialProps: { current: room } });
  rerender({ current: { ...room, participants: [{ id: "host", online: true }, { id: "guest", online: false }] } });
  await act(async () => resolve({ iceServers: [], relayAvailable: false })); expect(FakePeer.all).toHaveLength(0);
});
test("explicit stop invalidates a pending ICE configuration before it can reopen media", async () => {
  let resolve; const { room } = roomState({ getIceServers: () => new Promise((done) => { resolve = done; }) });
  const { result } = renderHook(() => useRoomMedia(room)); act(() => result.current.stop());
  await act(async () => resolve({ iceServers: [], relayAvailable: false })); expect(FakePeer.all).toHaveLength(0); expect(result.current.mediaStatus).toBe("idle");
});
test("remote video availability follows muted/unmuted receiver frames and reset cleans every listener", async () => {
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  const receiver = track("video", "remote"); receiver.muted = true; receiver.readyState = "live"; const remove = vi.spyOn(receiver, "removeEventListener");
  act(() => FakePeer.all[0].ontrack({ track: receiver, streams: [] })); expect(result.current.remoteStream.getVideoTracks()).toEqual([receiver]); expect(result.current.remoteVideoOn).toBe(false);
  act(() => { receiver.muted = false; receiver.dispatchEvent(new Event("unmute")); }); expect(result.current.remoteVideoOn).toBe(true);
  act(() => { receiver.muted = true; receiver.dispatchEvent(new Event("mute")); }); expect(result.current.remoteVideoOn).toBe(false);
  act(() => { receiver.muted = false; receiver.dispatchEvent(new Event("unmute")); }); expect(result.current.remoteVideoOn).toBe(true);
  await act(async () => result.current.retry()); expect(result.current.remoteVideoOn).toBe(false); expect(result.current.remoteStream).toBe(null); expect(remove.mock.calls.map(([name]) => name)).toEqual(["mute", "unmute", "ended"]);
  act(() => receiver.dispatchEvent(new Event("unmute"))); expect(result.current.remoteVideoOn).toBe(false);
});
test("ended remote camera removes its track and closes video availability", async () => {
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  const receiver = track("video", "remote"); receiver.muted = false; receiver.readyState = "live";
  act(() => FakePeer.all[0].ontrack({ track: receiver })); expect(result.current.remoteVideoOn).toBe(true);
  act(() => { receiver.readyState = "ended"; receiver.dispatchEvent(new Event("ended")); }); expect(result.current.remoteVideoOn).toBe(false); expect(result.current.remoteStream).toBe(null);
});
test("network reconnection and partner waiting clear stale media-fetch errors while keeping chat state intact", async () => {
  const { room } = roomState({ getIceServers: vi.fn().mockRejectedValue(new Error("Failed to fetch")) });
  const { result, rerender } = renderHook(({ current }) => useRoomMedia(current), { initialProps: { current: room } }); await act(async () => {});
  expect(result.current.error).toBe("Failed to fetch"); expect(result.current.mediaStatus).toBe("error");
  rerender({ current: { ...room, status: "reconnecting" } }); expect(result.current.error).toBe(""); expect(result.current.mediaStatus).toBe("reconnecting");
  rerender({ current: { ...room, participants: [{ id: "host", online: true }, { id: "guest", online: false }] } }); expect(result.current.error).toBe(""); expect(result.current.mediaStatus).toBe("waiting"); expect(room.status).toBe("connected");
});
test("failed idle media warm-up leaves text chat usable and a later camera request starts a fresh peer", async () => {
  const video = track("video"); const getUserMedia = vi.fn().mockResolvedValue(new FakeStream([video]));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {}); const dormant = FakePeer.all[0];
  act(() => { dormant.connectionState = "failed"; dormant.onconnectionstatechange(); });
  expect(result.current.error).toBe(""); expect(result.current.mediaStatus).toBe("waiting"); expect(room.status).toBe("connected"); expect(getUserMedia).not.toHaveBeenCalled();
  await act(async () => result.current.enableCamera()); expect(getUserMedia).toHaveBeenCalledOnce(); expect(FakePeer.all).toHaveLength(2); expect(dormant.close).toHaveBeenCalledOnce();
  expect(room.sendSignal).toHaveBeenCalledWith({ reset: true }); expect(FakePeer.all[1].transceivers[0].sender.track).toBe(video);
  act(() => { FakePeer.all[1].connectionState = "failed"; FakePeer.all[1].onconnectionstatechange(); });
  expect(result.current.error).toMatch(/could not connect/); expect(result.current.mediaStatus).toBe("error"); expect(room.status).toBe("connected");
});
test("idle connection timeout does not produce a video alert, and choosing live audio retries that dormant connection", async () => {
  vi.useFakeTimers(); const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(35000)); expect(result.current.error).toBe(""); expect(result.current.mediaStatus).toBe("waiting");
  await act(async () => result.current.setRemoteAudioEnabled(true)); expect(FakePeer.all).toHaveLength(2); expect(room.sendSignal).toHaveBeenCalledWith({ reset: true });
  act(() => { FakePeer.all[1].connectionState = "failed"; FakePeer.all[1].onconnectionstatechange(); }); expect(result.current.error).toMatch(/could not connect/); expect(result.current.mediaStatus).toBe("error");
});
test("connection loss after partner video was received remains visible even with local devices off", async () => {
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {});
  const receiver = track("video", "remote"); receiver.muted = false; receiver.readyState = "live"; const peer = FakePeer.all[0];
  act(() => peer.ontrack({ track: receiver })); expect(result.current.remoteVideoOn).toBe(true);
  act(() => { receiver.muted = true; receiver.dispatchEvent(new Event("mute")); peer.connectionState = "failed"; peer.onconnectionstatechange(); });
  expect(result.current.cameraOn).toBe(false); expect(result.current.micOn).toBe(false); expect(result.current.error).toMatch(/could not connect/); expect(room.status).toBe("connected");
});
test("dormant timeout preserves camera permission recovery instructions instead of replacing them with a network alert", async () => {
  vi.useFakeTimers(); const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => result.current.enableCamera());
  expect(result.current.cameraStatus).toBe("error"); expect(result.current.error).toMatch(/Camera access is blocked/);
  await act(async () => vi.advanceTimersByTimeAsync(35000)); expect(result.current.error).toMatch(/Camera access is blocked/); expect(result.current.error).not.toMatch(/connect across|too long/); expect(room.status).toBe("connected");
  act(() => { FakePeer.all[0].connectionState = "connected"; FakePeer.all[0].onconnectionstatechange(); }); expect(result.current.error).toMatch(/Camera access is blocked/);
});
test("pending microphone permission is visible, duplicate starts do not open devices, and cancellation releases a late stream", async () => {
  let resolve; const audio = track("audio"); const getUserMedia = vi.fn(() => new Promise((done) => { resolve = done; }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { room } = roomState(); const { result } = renderHook(() => useRoomMedia(room)); await act(async () => {}); let request;
  await act(async () => { request = result.current.enableMic(); }); expect(result.current.micStatus).toBe("starting"); expect(result.current.micOn).toBe(false);
  await act(async () => result.current.enableMic()); expect(getUserMedia).toHaveBeenCalledOnce();
  act(() => result.current.disableMic()); expect(result.current.micStatus).toBe("off");
  await act(async () => { resolve(new FakeStream([audio])); await request; }); expect(audio.stop).toHaveBeenCalledOnce(); expect(result.current.micOn).toBe(false); expect(result.current.micStatus).toBe("off");
});
test("microphone permission error survives peer-connected, reconnecting and partner-waiting transitions", async () => {
  const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { room } = roomState(); const { result, rerender } = renderHook(({ current }) => useRoomMedia(current), { initialProps: { current: room } }); await act(async () => result.current.enableMic());
  expect(result.current.micStatus).toBe("error"); expect(result.current.micOn).toBe(false); expect(result.current.error).toMatch(/Microphone access is blocked/);
  act(() => { FakePeer.all[0].connectionState = "connected"; FakePeer.all[0].onconnectionstatechange(); }); expect(result.current.error).toMatch(/Microphone access is blocked/);
  rerender({ current: { ...room, status: "reconnecting" } }); expect(result.current.error).toMatch(/Microphone access is blocked/);
  rerender({ current: room }); await act(async () => {}); expect(result.current.error).toMatch(/Microphone access is blocked/);
  rerender({ current: { ...room, participants: [{ id: "host", online: true }, { id: "guest", online: false }] } }); expect(result.current.error).toMatch(/Microphone access is blocked/); expect(result.current.micStatus).toBe("error");
});
