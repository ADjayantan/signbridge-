import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { RoomClient } from "../lib/roomClient.js";

export function useRoom() {
  const [client] = useState(() => new RoomClient({ baseUrl: import.meta.env.VITE_ROOM_SERVER_URL || "" }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const actions = useMemo(() => ({ create: client.create.bind(client), join: client.join.bind(client), send: client.send.bind(client), sendAction: client.sendAction.bind(client), leave: client.leave, end: client.end, retry: client.retry, sendSignal: client.sendSignal, subscribeSignal: client.subscribeSignal, getIceServers: client.getIceServers.bind(client), askAI: client.askAI.bind(client) }), [client]);
  useEffect(() => {
    client.closed = false;
    const online = () => client.setNetworkOnline(true); const offline = () => client.setNetworkOnline(false);
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    client.setNetworkOnline(navigator.onLine !== false); client.resume();
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); client.dispose(); };
  }, [client]);
  return { ...state, ...actions };
}
