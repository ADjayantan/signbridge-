// localStorage can be missing or throw (private mode, blocked storage, quota), so every access is guarded.
const PREFIX = "signbridge:";

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Returns true when saved, false when storage is unavailable or full. */
export function save(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
