import { useCallback, useEffect, useRef, useState } from "react";
import { deleteTrainingSample, listTrainingSamples, saveTrainingSample } from "../lib/trainingSamples.js";

export function useTrainingSamples() {
  const [samples, setSamples] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const mounted = useRef(false), readGeneration = useRef(0);
  const reload = useCallback(async () => {
    const generation = ++readGeneration.current;
    if (mounted.current) { setLoading(true); setError(""); }
    try {
      const all = await listTrainingSamples();
      if (mounted.current && generation === readGeneration.current) setSamples(all);
      return all;
    } catch (err) {
      if (mounted.current && generation === readGeneration.current) setError(err.message || "Couldn't load saved samples.");
      throw err;
    } finally { if (mounted.current && generation === readGeneration.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; reload().catch(() => {}); return () => { mounted.current = false; readGeneration.current++; }; }, [reload]);
  const add = useCallback(async (data) => {
    readGeneration.current++;
    if (mounted.current) setError("");
    try {
      const sample = await saveTrainingSample(data);
      if (mounted.current) {
        setSamples((all) => [...all.filter((row) => row.id !== sample.id), sample]);
        // Include rows from other tabs and a still-pending initial load. A reload
        // failure must not report a committed write as failed and invite duplicates.
        await reload().catch(() => {});
      }
      return sample;
    } catch (err) { if (mounted.current) { setError(err.message || "Couldn't save the sample."); setLoading(false); } throw err; }
  }, [reload]);
  const remove = useCallback(async (id) => {
    readGeneration.current++;
    if (mounted.current) setError("");
    try {
      await deleteTrainingSample(id);
      if (mounted.current) {
        setSamples((all) => all.filter((sample) => sample.id !== id));
        await reload().catch(() => {});
      }
    } catch (err) { if (mounted.current) { setError(err.message || "Couldn't delete the sample."); setLoading(false); } throw err; }
  }, [reload]);
  return { samples, loading, error, add, remove, reload };
}
