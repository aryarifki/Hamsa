/**
 * Polaris-X preview gate.
 *
 * Phone-X exposes a short live preview window and then forces a cooldown so a
 * single account cannot stream the situation layer indefinitely. The same
 * shape is kept here: 5 minutes active, 35 minutes of cooldown measured from
 * the moment the window opened.
 *
 * State lives in-process, which matches the rest of Hamsa (single-node
 * deployment, in-memory rate limiter). Restarting the server clears a cooldown;
 * that is a deliberate trade for zero extra infrastructure.
 */

export const PREVIEW_ACTIVE_MS = 5 * 60_000;
export const PREVIEW_COOLDOWN_MS = 35 * 60_000;

export class PreviewError extends Error {
  readonly code = "POLARIS_PREVIEW_EXPIRED";

  constructor(message = "Polaris preview has expired. Start a new preview window.") {
    super(message);
  }
}

interface PreviewState {
  startedAt: number;
  expiresAt: number;
  cooldownUntil: number;
}

const windows = new Map<string, PreviewState>();

export interface PreviewStatus {
  active: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  cooldownUntil: string | null;
  secondsRemaining: number;
  secondsUntilNext: number;
  activeMs: number;
  cooldownMs: number;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function previewStatus(userId: string): PreviewStatus {
  const now = Date.now();
  const state = windows.get(userId);

  if (!state) {
    return {
      active: false,
      startedAt: null,
      expiresAt: null,
      cooldownUntil: null,
      secondsRemaining: 0,
      secondsUntilNext: 0,
      activeMs: PREVIEW_ACTIVE_MS,
      cooldownMs: PREVIEW_COOLDOWN_MS,
    };
  }

  const active = state.expiresAt > now;
  return {
    active,
    startedAt: iso(state.startedAt),
    expiresAt: iso(state.expiresAt),
    cooldownUntil: iso(state.cooldownUntil),
    secondsRemaining: active ? Math.ceil((state.expiresAt - now) / 1000) : 0,
    secondsUntilNext: active ? 0 : Math.max(0, Math.ceil((state.cooldownUntil - now) / 1000)),
    activeMs: PREVIEW_ACTIVE_MS,
    cooldownMs: PREVIEW_COOLDOWN_MS,
  };
}

/** Opens a window, or throws `PreviewError` while the cooldown is still running. */
export function startPreview(userId: string): PreviewStatus {
  const now = Date.now();
  const state = windows.get(userId);

  if (state) {
    if (state.expiresAt > now) return previewStatus(userId);
    if (state.cooldownUntil > now) {
      const seconds = Math.ceil((state.cooldownUntil - now) / 1000);
      throw new PreviewError(`Polaris preview is cooling down for another ${seconds}s.`);
    }
  }

  windows.set(userId, {
    startedAt: now,
    expiresAt: now + PREVIEW_ACTIVE_MS,
    cooldownUntil: now + PREVIEW_COOLDOWN_MS,
  });
  return previewStatus(userId);
}

/** Throws unless the caller currently holds a live window. */
export function assertPreview(userId: string): PreviewStatus {
  const status = previewStatus(userId);
  if (!status.active) throw new PreviewError();
  return status;
}

/** Test hook — drops all state so one test cannot poison the next. */
export function resetPreviews(): void {
  windows.clear();
}
