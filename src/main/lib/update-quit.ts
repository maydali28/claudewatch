// Coordinates the app-quit side of an update install.
//
// `autoUpdater.quitAndInstall()` (macOS: Squirrel) does not emit `before-quit`
// — it emits `before-quit-for-update` instead, and nothing in the update path
// otherwise calls `app.quit()`. See `src/main/index.ts` for the full story of
// why the handoff below exists.
//
// State lives at module scope (not behind a class) so `index.ts` and
// `window-manager.ts` — which never share a constructor call — observe the
// same flag and timers. Kept dependency-free of `electron` so this file stays
// unit-testable without mocking it.

const UPDATE_QUIT_HANDOFF_MS = 2_000
const UPDATE_QUIT_HARD_EXIT_MS = 5_000

interface UpdateQuitDeps {
  quit: () => void
  exit: (code: number) => void
  log: { info: (m: string) => void; warn: (m: string) => void }
}

interface UpdateQuitHandlerDeps {
  app: { on(event: string, fn: () => void): unknown; quit(): void; exit(code: number): void }
  squirrelUpdater: { on(event: string, fn: () => void): unknown }
  log: { info(m: string): void; warn(m: string): void }
}

let quitting = false
let handoff: NodeJS.Timeout | null = null
let hardExit: NodeJS.Timeout | null = null
let disarmedListeners: Array<() => void> = []

export function isAppQuitting(): boolean {
  return quitting
}

export function markAppQuitting(): void {
  quitting = true
}

/**
 * Called on `before-quit-for-update`. Arms the cooperative quit (2 s) and
 * hard exit (5 s more). Idempotent — a second call while a handoff or hard
 * exit is already scheduled does not double the timers.
 */
export function armUpdateQuit(deps: UpdateQuitDeps): void {
  quitting = true
  if (handoff || hardExit) return
  handoff = setTimeout(() => {
    handoff = null
    deps.log.info('Quitting so ShipIt can install the update')
    deps.quit()
    // app.quit() is cooperative — anything that prevents the quit would leave
    // ShipIt waiting again. Exiting is strictly better than a silent no-op:
    // the update is already staged and ShipIt relaunches us afterwards.
    hardExit = setTimeout(() => {
      hardExit = null
      deps.log.warn('Quit did not complete — exiting so the update can proceed')
      deps.exit(0)
    }, UPDATE_QUIT_HARD_EXIT_MS)
  }, UPDATE_QUIT_HANDOFF_MS)
}

/**
 * Called when the updater reports an error after an install was requested.
 * Clears timers and the quitting flag so the app keeps running normally, then
 * notifies every listener registered via `onUpdateQuitDisarmed` — this is how
 * `index.ts` recovers a dashboard window that was already on its way out.
 *
 * Note the two failure shapes are not the same. The authorization panel is
 * raised by the native updater inside `quitAndInstall`, before
 * `before-quit-for-update` and before any window closes, so a cancelled
 * password prompt arrives with nothing armed and nothing torn down. Only a
 * failure after that handoff — the quit armed, windows closing — needs the
 * window recovery. (A cancelled authorization is cached on that native
 * updater, which is why clicking Install again did nothing; a fresh
 * `downloadUpdate()` re-runs `setFeedURL` and builds a new native updater, so
 * the prompt reappears.)
 */
export function disarmUpdateQuit(): void {
  if (handoff) clearTimeout(handoff)
  if (hardExit) clearTimeout(hardExit)
  handoff = null
  hardExit = null
  quitting = false
  for (const listener of disarmedListeners) listener()
}

/**
 * Register a listener to run every time `disarmUpdateQuit()` clears state.
 * Listeners accumulate for the lifetime of the module — callers are expected
 * to register once at startup, not per-event.
 */
export function onUpdateQuitDisarmed(listener: () => void): void {
  disarmedListeners.push(listener)
}

/**
 * Wires the two event listeners that drive the quit handoff:
 * `before-quit` on `app` marks a real quit in progress, and
 * `before-quit-for-update` on Electron's built-in `autoUpdater` (Squirrel —
 * never emitted by `app`) arms the cooperative quit / hard exit. Registering
 * the second listener on `app` instead of the updater is the exact bug that
 * shipped in 1.2.6–1.2.9: the handler existed but never fired, so "Install &
 * Restart" silently did nothing. Kept electron-free (deps are passed in) so
 * this stays unit-testable without mocking `electron`.
 */
export function registerUpdateQuitHandlers(deps: UpdateQuitHandlerDeps): void {
  deps.app.on('before-quit', markAppQuitting)
  deps.squirrelUpdater.on('before-quit-for-update', () => {
    armUpdateQuit({
      quit: () => deps.app.quit(),
      exit: (code) => deps.app.exit(code),
      log: deps.log,
    })
  })
}
