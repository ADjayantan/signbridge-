import { useCallback, useEffect, useRef, useState } from "react";

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
 * status: "off" | "starting" | "on" | "error"
 */
export function useCamera({ active, facingMode = "user" }) {
  const videoRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", status: "starting", error: "" });
  const key = `${facingMode}:${attempt}`;

  useEffect(() => {
    if (!active) return undefined;
    let stream = null;
    let cancelled = false;
    const video = videoRef.current;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("getUserMedia unavailable"), { name: "NotSupportedError" });
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        if (!cancelled) setResult({ key, status: "on", error: "" });
      } catch (err) {
        if (!cancelled) setResult({ key, status: "error", error: cameraErrorMessage(err) });
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
      setResult({ key: "", status: "starting", error: "" });
    };
  }, [active, facingMode, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result.key === key ? result : { status: "starting", error: "" };
  return { videoRef, status: active ? current.status : "off", error: active ? current.error : "", retry };
}
