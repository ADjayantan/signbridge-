import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeCameraFrame } from "../lib/cameraFrameHealth.js";

function preferredCamera(devices) {
  const virtual = (d) => /virtual|redmi|phone|droid|iriun|obs|snap camera|continuity/i.test(d.label);
  const physical = devices.filter((d) => d.label && !virtual(d));
  // Preserve facingMode selection on phones with front/back cameras. Override the
  // browser default when an integrated webcam or unwanted virtual camera is present.
  return physical.find((d) => /integrated|built.?in|internal|facetime|easycamera|truevision|thinkpad/i.test(d.label)) || (devices.some(virtual) ? physical[0] : undefined);
}

function cameraErrorMessage(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Connect a camera and try again.";
    case "NotReadableError":
      return "The camera is being used by another app. Close that app and try again.";
    case "NotSupportedError":
      return "This browser can't use the camera here. Use Chrome or Edge, on https or localhost.";
    default:
      return "The camera couldn't start. Try again.";
  }
}

/**
 * Starts the camera while `active` is true and stops it afterwards.
 * Render <video ref={videoRef} muted playsInline /> at all times so the stream has a target.
 * preferredFormat "widescreen" requests 1280×720 when the camera supports it.
 * All format constraints are ideals; the browser's actual stream may differ.
 * status: "off" | "starting" | "on" | "error"
 */
export function useCamera({ active, facingMode = "user", deviceId = "", preferredFormat = "standard" }) {
  const videoRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", status: "starting", error: "" });
  const [health, setHealth] = useState({ key: "", value: "unknown" });
  const [devices, setDevices] = useState([]);
  const format = preferredFormat === "widescreen" ? "widescreen" : "standard";
  const key = JSON.stringify([facingMode, deviceId, format, attempt]);

  useEffect(() => {
    if (!active) return undefined;
    let stream = null;
    let cancelled = false;
    const video = videoRef.current;
    const release = () => { stream?.getTracks().forEach((t) => { t.removeEventListener?.("ended", lostCamera); t.stop(); }); stream = null; };
    const lostCamera = () => {
      if (cancelled) return;
      release();
      if (video) video.srcObject = null;
      setResult({ key, status: "error", error: "Camera disconnected. Reconnect it and try again." });
    };
    const discover = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices?.() || [];
        const cameras = all.filter((d) => d.kind === "videoinput" && d.deviceId);
        if (!cancelled) setDevices(cameras);
        return cameras;
      } catch { return []; }
    };
    const open = (id) => navigator.mediaDevices.getUserMedia({
      video: { ...(id ? { deviceId: { exact: id } } : { facingMode }),
        ...(format === "widescreen"
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } }),
      },
      audio: false,
    });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("getUserMedia unavailable"), { name: "NotSupportedError" });
        }
        const available = await discover();
        if (cancelled) return;
        let selected = deviceId || preferredCamera(available)?.deviceId || "";
        stream = await open(selected);
        if (cancelled) { release(); return; }
        // Labels may be hidden before permission. Recheck once permission is granted so
        // a default phone/virtual camera cannot silently win over the laptop webcam.
        const permitted = await discover();
        if (cancelled) { release(); return; }
        const preferred = !deviceId && preferredCamera(permitted);
        const currentId = stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || selected;
        if (preferred && preferred.deviceId !== currentId) {
          release(); selected = preferred.deviceId; stream = await open(selected);
          if (cancelled) { release(); return; }
        }
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        stream?.getVideoTracks?.().forEach((t) => t.addEventListener?.("ended", lostCamera, { once: true }));
        if (!cancelled) setResult({ key, status: "on", error: "", name: stream.getVideoTracks?.()[0]?.label || "Default webcam", deviceId: stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || selected });
      } catch (err) {
        release();
        if (!cancelled) setResult({ key, status: "error", error: cameraErrorMessage(err) });
      }
    })();

    return () => {
      cancelled = true;
      release();
      if (video) video.srcObject = null;
      setResult({ key: "", status: "starting", error: "" });
    };
  }, [active, facingMode, deviceId, format, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result.key === key ? result : { status: "starting", error: "" };
  useEffect(() => {
    let cancelled = false, consecutiveDark = 0;
    const publish = (value) => {
      if (!cancelled) setHealth((previous) => previous.key === key && previous.value === value ? previous : { key, value });
    };
    publish("unknown");
    if (!active || current.status !== "on") return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 24;
    let context = null;
    const sample = () => {
      const video = videoRef.current;
      let next = "unknown";
      if (video?.readyState >= 2 && video.videoWidth && video.videoHeight && !video.paused && !video.ended) {
        try {
          context ||= canvas.getContext("2d", { willReadFrequently: true });
          if (context) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            next = analyzeCameraFrame(context.getImageData(0, 0, canvas.width, canvas.height));
          }
        } catch { /* Unreadable frames are unknown, not a dark-camera diagnosis. */ }
      }
      if (next === "dark") {
        consecutiveDark++;
        if (consecutiveDark >= 3) publish("dark");
      } else {
        consecutiveDark = 0;
        publish(next);
      }
    };
    sample();
    const timer = setInterval(sample, 1000);
    return () => { cancelled = true; clearInterval(timer); canvas.width = 0; canvas.height = 0; };
  }, [active, key, current.status]);
  return { videoRef, status: active ? current.status : "off", error: active ? current.error : "", name: active && current.status === "on" ? current.name : "", selectedDeviceId: current.deviceId || deviceId, devices, retry, frameHealth: active && current.status === "on" && health.key === key ? health.value : "unknown" };
}
