import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const reloadCurrentPage = () => window.location.reload();
const failureMessage = "The update could not start. Your current session is still open. Try again when you are ready.";

/** A waiting app update never interrupts the current conversation on its own. */
export default function AppUpdateNotice({ reloadPage = reloadCurrentPage }) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const requested = useRef(false), mounted = useRef(true), busy = useRef(false);
  const { needRefresh: [waiting, setWaiting], updateServiceWorker } = useRegisterSW({
    immediate: true,
    onNeedReload() {
      // Another tab can activate the worker; this tab keeps its turn until its own choice.
      if (!mounted.current) return;
      if (requested.current) reloadPage();
      else setWaiting(false);
    },
    onRegisterError() {
      if (!mounted.current) return;
      requested.current = false; busy.current = false; setUpdating(false); setError(failureMessage);
    },
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requested.current = false; };
  }, []);
  const update = async () => {
    if (!waiting || busy.current) return;
    busy.current = true; requested.current = true; setUpdating(true); setError("");
    try { await updateServiceWorker(true); }
    catch {
      requested.current = false; busy.current = false;
      if (mounted.current) { setUpdating(false); setError(failureMessage); }
    }
  };
  if (!waiting) return null;
  return <aside className="notice app-update-notice" aria-label="App update available" aria-busy={updating}>
    <p role="status"><strong>A SignBridge update is ready.</strong> Finish your current turn and copy unsent text before updating. Updating reloads this page.</p>
    <button type="button" className="btn btn-small" disabled={updating} onClick={() => void update()}>{updating ? "Updating…" : "Update and reload"}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </aside>;
}
