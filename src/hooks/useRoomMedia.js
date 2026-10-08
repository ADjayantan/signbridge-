import { useCallback, useEffect, useRef, useState } from "react";

function preferredCamera(devices) {
  const virtual = (device) => /virtual|redmi|phone|droid|iriun|obs|snap camera|continuity/i.test(device.label);
  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  const physical = cameras.filter((device) => device.label && !virtual(device));
  return physical.find((device) => /integrated|built.?in|internal|facetime|easycamera|truevision|thinkpad/i.test(device.label)) || (cameras.some(virtual) ? physical[0] : undefined);
}
function inputError(error, kind) {
  const label = kind === "video" ? "Camera" : "Microphone";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return `${label} access is blocked. Allow it in browser settings and retry. Typing still works.`;
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return `No ${label.toLowerCase()} was found. Connect a device and retry. Typing still works.`;
  if (error?.name === "NotReadableError") return `${label} is busy in another app. Close that app and retry.`;
  return `${label} could not start. Use Chrome on HTTPS or localhost and retry. Typing still works.`;
}
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());

/** Owns camera/mic once; recognition and the call share localVideoRef/localStream. */
export function useRoomMedia(room) {
  const localVideoRef = useRef(null); const remoteVideoRef = useRef(null);
  const roomRef = useRef(room); roomRef.current = room;
  const pcRef = useRef(null); const peerGeneration = useRef(0); const peerTimers = useRef({ connection: null, disconnect: null }); const owned = useRef({ video: null, audio: null });
  const peerFailed = useRef(false); const peerHadRemoteVideo = useRef(false); const remoteAudioEnabledRef = useRef(false); const inputFailure = useRef("");
  const desired = useRef({ video: false, audio: false }); const inputGeneration = useRef({ video: 0, audio: 0 });
  const mounted = useRef(true); const signalQueue = useRef([]); const acceptSignalRef = useRef(null); const receiverTracks = useRef(new Map());
  const [localStream, setLocalStream] = useState(null); const [remoteStream, setRemoteStream] = useState(null);
  const [remoteVideoOn, setRemoteVideoOn] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("off"); const [micStatus, setMicStatus] = useState("off");
  const micOn = micStatus === "on";
  const [mediaStatus, setMediaStatus] = useState("idle"); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [forceRelay, setForceRelay] = useState(false); const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(false); const [attempt, setAttempt] = useState(0);
  remoteAudioEnabledRef.current = remoteAudioEnabled;

  const recoverDormantPeer = useCallback(() => {
    if (!peerFailed.current || roomRef.current.status !== "connected") return;
    peerFailed.current = false; roomRef.current.sendSignal({ reset: true }); setAttempt((number) => number + 1);
  }, []);

  const refreshLocalStream = useCallback(() => {
    const tracks = [owned.current.video, owned.current.audio].filter(Boolean).flatMap((stream) => stream.getTracks());
    if (mounted.current) setLocalStream(tracks.length ? new MediaStream(tracks) : null);
  }, []);
  const disableInput = useCallback((kind) => {
    desired.current[kind] = false; inputGeneration.current[kind] += 1;
    stopTracks(owned.current[kind]); owned.current[kind] = null;
    if (mounted.current) { kind === "video" ? setCameraStatus("off") : setMicStatus("off"); refreshLocalStream(); }
  }, [refreshLocalStream]);
  const enableInput = useCallback(async (kind) => {
    if (desired.current[kind] && owned.current[kind]) return;
    if (desired.current[kind] && !owned.current[kind]) return; // Permission request already pending.
    desired.current[kind] = true; const generation = ++inputGeneration.current[kind];
    kind === "video" ? setCameraStatus("starting") : setMicStatus("starting"); inputFailure.current = ""; setError("");
    const valid = () => mounted.current && desired.current[kind] && generation === inputGeneration.current[kind];
    let acquired = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Media is unavailable");
      const discover = async () => { try { return await navigator.mediaDevices.enumerateDevices?.() || []; } catch { return []; } };
      const openCamera = (id) => navigator.mediaDevices.getUserMedia({ video: { ...(id ? { deviceId: { exact: id } } : { facingMode: "user" }), width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (kind === "video") {
        const camera = preferredCamera(await discover()); if (!valid()) return;
        acquired = await openCamera(camera?.deviceId);
        if (!valid()) { stopTracks(acquired); return; }
        const preferred = preferredCamera(await discover());
        if (!valid()) { stopTracks(acquired); return; }
        const actualId = acquired.getVideoTracks()[0]?.getSettings?.().deviceId || camera?.deviceId;
        if (preferred && preferred.deviceId !== actualId) { stopTracks(acquired); acquired = await openCamera(preferred.deviceId); }
      } else acquired = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
      if (!valid()) { stopTracks(acquired); return; }
      owned.current[kind] = acquired;
      acquired.getTracks().forEach((track) => track.addEventListener?.("ended", () => {
        if (!valid()) return; disableInput(kind); inputFailure.current = `${kind === "video" ? "Camera" : "Microphone"} disconnected. Reconnect the device and retry. Typing still works.`; setError(inputFailure.current); kind === "video" ? setCameraStatus("error") : setMicStatus("error");
      }, { once: true }));
      if (kind === "video") setCameraStatus("on"); else setMicStatus("on");
      refreshLocalStream(); recoverDormantPeer();
    } catch (failure) {
      stopTracks(acquired); if (!valid()) return; desired.current[kind] = false;
      inputFailure.current = inputError(failure, kind); setError(inputFailure.current); if (kind === "video") setCameraStatus("error"); else setMicStatus("error");
    }
  }, [disableInput, refreshLocalStream, recoverDormantPeer]);
  const enableCamera = useCallback(() => enableInput("video"), [enableInput]);
  const disableCamera = useCallback(() => disableInput("video"), [disableInput]);
  const enableMic = useCallback(() => enableInput("audio"), [enableInput]);
  const disableMic = useCallback(() => disableInput("audio"), [disableInput]);
  const refreshRemoteStream = useCallback(() => {
    if (!mounted.current) return;
    const tracks = [...receiverTracks.current.values()].map((entry) => entry.track).filter((track) => track.readyState !== "ended");
    if (tracks.some((track) => track.kind === "video" && !track.muted)) peerHadRemoteVideo.current = true;
    setRemoteStream(tracks.length ? new MediaStream(tracks) : null);
    setRemoteVideoOn(tracks.some((track) => track.kind === "video" && !track.muted));
  }, []);
  const closePeer = useCallback(() => {
    peerGeneration.current += 1;
    clearTimeout(peerTimers.current.connection); clearTimeout(peerTimers.current.disconnect); peerTimers.current = { connection: null, disconnect: null };
    peerFailed.current = false; peerHadRemoteVideo.current = false;
    const peer = pcRef.current; pcRef.current = null;
    if (peer) { peer.ontrack = null; peer.onicecandidate = null; peer.onnegotiationneeded = null; peer.onconnectionstatechange = null; peer.close(); }
    receiverTracks.current.forEach((entry) => entry.cleanup()); receiverTracks.current.clear();
    acceptSignalRef.current = null; signalQueue.current = [];
    if (mounted.current) { setRemoteStream(null); setRemoteVideoOn(false); }
  }, []);
  const stop = useCallback(() => {
    disableInput("video"); disableInput("audio"); closePeer();
    inputFailure.current = "";
    if (mounted.current) { setMediaStatus("idle"); setError(""); setNotice(""); setRemoteAudioEnabled(false); }
  }, [disableInput, closePeer]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; desired.current = { video: false, audio: false }; inputGeneration.current.video++; inputGeneration.current.audio++; stopTracks(owned.current.video); stopTracks(owned.current.audio); owned.current = { video: null, audio: null }; closePeer(); };
  }, [closePeer]);
  useEffect(() => {
    const video = localVideoRef.current; if (!video) return;
    video.muted = true; video.srcObject = localStream;
    if (localStream) Promise.resolve(video.play()).catch(() => {}); else video.pause?.();
  }, [localStream]);
  useEffect(() => {
    const video = remoteVideoRef.current; if (!video) return;
    video.muted = !remoteAudioEnabled; video.srcObject = remoteStream;
    if (remoteStream) Promise.resolve(video.play()).catch(() => setNotice("Tap the partner video to start playback.")); else video.pause?.();
  }, [remoteStream, remoteAudioEnabled]);
  useEffect(() => room.subscribeSignal((data) => {
    if (data?.reset) { signalQueue.current = []; setAttempt((n) => n + 1); return; }
    if (acceptSignalRef.current) acceptSignalRef.current(data);
    else if (signalQueue.current.length < 200) signalQueue.current.push(data);
  }), [room.subscribeSignal]);
  useEffect(() => { if (remoteAudioEnabled) recoverDormantPeer(); }, [remoteAudioEnabled, recoverDormantPeer]);

  const partnerOnline = room.participants.some((participant) => participant.id !== room.participantId && participant.online);
  useEffect(() => {
    if (room.status === "ended" || room.status === "idle" || room.status === "error") { stop(); return undefined; }
    if (room.status !== "connected" || !partnerOnline) { closePeer(); setError(inputFailure.current); setMediaStatus(room.status === "reconnecting" ? "reconnecting" : "waiting"); return undefined; }
    const generation = ++peerGeneration.current;
    let cancelled = false; let peer = null; let makingOffer = false; let ignoreOffer = false; let settingRemoteAnswer = false;
    const polite = room.role === "guest"; const candidates = []; let signalChain = Promise.resolve(); let failureTimer = null; let connectionTimer = null;
    const valid = () => !cancelled && generation === peerGeneration.current && peer && pcRef.current === peer;
    const fail = (message) => {
      if (!valid()) return;
      peerFailed.current = true;
      // Receive transceivers warm up without user media. A dormant ICE failure
      // should not turn a working text conversation into a video error alert.
      const wanted = desired.current.video || desired.current.audio || remoteAudioEnabledRef.current || peerHadRemoteVideo.current || forceRelay;
      setMediaStatus(wanted ? "error" : "waiting"); setError(wanted ? message : inputFailure.current);
    };
    const applySignal = async (data) => {
      if (!valid() || !data) return;
      try {
        if (data.description) {
          const ready = !makingOffer && (peer.signalingState === "stable" || settingRemoteAnswer);
          const collision = data.description.type === "offer" && !ready;
          ignoreOffer = !polite && collision; if (ignoreOffer) return;
          settingRemoteAnswer = data.description.type === "answer";
          await peer.setRemoteDescription(data.description); settingRemoteAnswer = false;
          while (candidates.length && valid()) await peer.addIceCandidate(candidates.shift());
          if (data.description.type === "offer" && valid()) { await peer.setLocalDescription(); if (valid()) roomRef.current.sendSignal({ description: peer.localDescription }); }
        } else if (data.candidate) {
          if (ignoreOffer) return;
          if (!peer.remoteDescription) candidates.push(data.candidate); else await peer.addIceCandidate(data.candidate);
        }
      } catch { settingRemoteAnswer = false; if (!ignoreOffer) fail("Video negotiation was interrupted. Retry video; text messages still work."); }
    };
    setMediaStatus("connecting"); setError(inputFailure.current);
    (async () => {
      try {
        const config = await roomRef.current.getIceServers({ forceRelay }); if (cancelled || generation !== peerGeneration.current) return;
        const hasRelay = config.relayAvailable && config.iceServers?.some((server) => [server.urls].flat().some((url) => /^turns?:/i.test(url)));
        setNotice(config.notice || (!hasRelay ? "Video relay is unavailable. Some networks may block video; text messages still work." : ""));
        if (forceRelay && !hasRelay) { setMediaStatus("error"); setError("Forced relay requires TURN credentials. Text messages still work."); return; }
        if (typeof RTCPeerConnection === "undefined") { setMediaStatus("error"); setError("This browser cannot make video calls. Use Chrome; text messages still work."); return; }
        peer = new RTCPeerConnection({ iceServers: config.iceServers || [], iceTransportPolicy: forceRelay ? "relay" : "all" }); pcRef.current = peer;
        connectionTimer = setTimeout(() => fail("Video is taking too long to connect. Retry video or configure relay; text messages still work."), 35000);
        peerTimers.current.connection = connectionTimer;
        // Receive a partner's camera/audio even when local devices are off.
        const combined = new MediaStream([owned.current.video, owned.current.audio].filter(Boolean).flatMap((stream) => stream.getTracks()));
        for (const kind of ["video", "audio"]) {
          const track = combined.getTracks().find((item) => item.kind === kind);
          peer.addTransceiver(track || kind, { direction: "sendrecv", ...(track ? { streams: [combined] } : {}) });
        }
        peer.onicecandidate = (event) => { if (valid() && event.candidate) roomRef.current.sendSignal({ candidate: event.candidate.toJSON?.() || event.candidate }); };
        peer.ontrack = (event) => {
          if (!valid()) return;
          const track = event.track; const key = track.id || track;
          const previous = receiverTracks.current.get(key);
          if (previous?.track !== track) {
            previous?.cleanup();
            const changed = () => { if (valid()) refreshRemoteStream(); };
            const ended = () => { if (!valid()) return; const entry = receiverTracks.current.get(key); if (entry?.track === track) { entry.cleanup(); receiverTracks.current.delete(key); refreshRemoteStream(); } };
            track.addEventListener?.("mute", changed); track.addEventListener?.("unmute", changed); track.addEventListener?.("ended", ended);
            receiverTracks.current.set(key, { track, cleanup: () => { track.removeEventListener?.("mute", changed); track.removeEventListener?.("unmute", changed); track.removeEventListener?.("ended", ended); } });
          }
          refreshRemoteStream();
        };
        peer.onconnectionstatechange = () => {
          if (!valid()) return;
          clearTimeout(failureTimer);
          if (peer.connectionState === "connected") { clearTimeout(connectionTimer); peerFailed.current = false; setMediaStatus("connected"); setError(inputFailure.current); }
          else if (peer.connectionState === "failed") fail("Video could not connect across these networks. Retry video or enable relay; text messages still work.");
          else if (peer.connectionState === "disconnected") { setMediaStatus("reconnecting"); failureTimer = setTimeout(() => fail("The video connection was lost. Retry video; text messages still work."), 10000); peerTimers.current.disconnect = failureTimer; }
          else if (peer.connectionState === "connecting") setMediaStatus("connecting");
        };
        peer.onnegotiationneeded = async () => {
          if (!valid()) return;
          try { makingOffer = true; await peer.setLocalDescription(); if (valid()) roomRef.current.sendSignal({ description: peer.localDescription }); }
          catch { fail("Video negotiation failed. Retry video; text messages still work."); }
          finally { makingOffer = false; }
        };
        acceptSignalRef.current = (data) => { signalChain = signalChain.then(() => applySignal(data)); };
        signalQueue.current.splice(0).forEach((data) => acceptSignalRef.current(data));
      } catch (failure) { if (!cancelled && generation === peerGeneration.current) { setMediaStatus("error"); setError(failure.message || "Could not load video settings. Text messages still work."); } }
    })();
    return () => { cancelled = true; clearTimeout(failureTimer); clearTimeout(connectionTimer); closePeer(); };
  }, [room.status, room.roomId, room.participantId, room.role, partnerOnline, forceRelay, attempt, closePeer, stop, refreshRemoteStream]);

  // Replace tracks instead of opening a second camera when recognition or controls change.
  useEffect(() => {
    const peer = pcRef.current; if (!peer) return;
    for (const transceiver of peer.getTransceivers()) {
      const kind = transceiver.receiver.track.kind;
      const track = localStream?.getTracks().find((item) => item.kind === kind) || null;
      if (transceiver.sender.track !== track) transceiver.sender.replaceTrack(track).catch(() => { if (mounted.current && pcRef.current === peer) setError("A camera/microphone change could not reach your partner. Retry video."); });
    }
  }, [localStream]);
  const retry = useCallback(() => {
    setError(""); signalQueue.current = []; roomRef.current.sendSignal({ reset: true }); setAttempt((n) => n + 1);
    if (cameraStatus === "error") enableCamera();
  }, [cameraStatus, enableCamera]);
  return { localVideoRef, remoteVideoRef, cameraOn: cameraStatus === "on", micOn, micStatus, cameraStatus, mediaStatus, error, notice, localStream, remoteStream, remoteVideoOn, enableCamera, disableCamera, enableMic, disableMic, retry, stop, forceRelay, setForceRelay, remoteAudioEnabled, setRemoteAudioEnabled };
}
