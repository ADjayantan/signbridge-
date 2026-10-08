import { useCallback, useEffect, useState } from "react";
import { deleteSignVideo, listSignVideos, saveSignVideo } from "../lib/signVideos.js";

export function useSignVideos() {
  const [clips, setClips] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    listSignVideos().then((all) => { if (alive) setClips(all); }, (e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const add = useCallback(async (data) => {
    const clip = await saveSignVideo(data);
    setClips((all) => [...all, clip]);
  }, []);
  const remove = useCallback(async (id) => {
    await deleteSignVideo(id);
    setClips((all) => all.filter((c) => c.id !== id));
  }, []);
  return { clips, error, loading, add, remove };
}
