/**
 * OSIRIS — CCTV favorites (Polaris parity).
 *
 * One localStorage set, shared by the map filter, the layer counts and the
 * viewer's star. Toggling dispatches an event so every consumer re-reads
 * without prop threading.
 */
const KEY = 'osiris:cctv:favorites';

export const CAMERA_FAVORITES_EVENT = 'osiris:cctv:favorites';

export function loadFavoriteCameras(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((i: unknown) => typeof i === 'string') : [];
  } catch {
    return [];
  }
}

export function isFavoriteCamera(id: string): boolean {
  return loadFavoriteCameras().includes(id);
}

/** Toggles and returns the new state. */
export function toggleFavoriteCamera(id: string): boolean {
  const current = new Set(loadFavoriteCameras());
  const now = !current.has(id);
  if (now) current.add(id);
  else current.delete(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...current]));
  } catch {
    /* private mode — the in-memory event still updates this tab */
  }
  window.dispatchEvent(new Event(CAMERA_FAVORITES_EVENT));
  return now;
}
