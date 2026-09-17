// Sizes the update window to its measured content instead of a fixed 520×640.
// The renderer measures its root element and asks main to resize the window
// (see `useFitWindowToContent` in update-window.tsx); main clamps again before
// calling `setContentSize` since the renderer's measurement is untrusted input.

export const UPDATE_WINDOW_WIDTH = 520
export const UPDATE_WINDOW_MIN_HEIGHT = 300
export const UPDATE_WINDOW_MAX_HEIGHT = 760

/** Content height the renderer measured → window content height to request. Rounds up and clamps. */
export function clampUpdateWindowHeight(measured: number): number {
  if (!Number.isFinite(measured)) return UPDATE_WINDOW_MIN_HEIGHT
  return Math.min(UPDATE_WINDOW_MAX_HEIGHT, Math.max(UPDATE_WINDOW_MIN_HEIGHT, Math.ceil(measured)))
}
