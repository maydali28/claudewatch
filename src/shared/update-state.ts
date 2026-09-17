import type { UpdateInfo, UpdateServiceError } from '@shared/types/project'

/**
 * The single update state machine shared by all three renderer surfaces that
 * show update UI: the standalone update window, the About panel, and the
 * tray popover's update modal.
 *
 * Before this file existed, each surface kept its own local `UpdateState`
 * (a `DownloadState`-shaped subset that only covered idle/downloading/ready/
 * error) and discarded the result of `ipc.updates.install()`, so a failed or
 * cancelled install looked exactly like nothing happened: the button did
 * nothing, said nothing, and there was no way to retry short of quitting and
 * relaunching the app. Consolidating the transitions here means the "install
 * failed" and "retry" paths are defined once, are unit-testable without a
 * renderer, and cannot drift between surfaces.
 */
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date' }
  | { phase: 'available'; info: UpdateInfo }
  | { phase: 'downloading'; info: UpdateInfo; progress: number }
  | { phase: 'ready'; info: UpdateInfo }
  | { phase: 'installing'; info: UpdateInfo }
  | {
      phase: 'error'
      failed: 'check' | 'download' | 'install'
      message: string
      hint?: string
      info: UpdateInfo | null
    }

export type UpdateEvent =
  | { type: 'check-start' }
  | { type: 'check-ok'; info: UpdateInfo | null }
  | { type: 'check-fail'; message: string }
  | { type: 'download-start' }
  | { type: 'progress'; percent: number }
  | { type: 'download-ok' }
  | { type: 'download-fail'; message: string }
  | { type: 'install-start' }
  | { type: 'install-fail'; message: string }
  | { type: 'service-error'; error: UpdateServiceError }
  | { type: 'retry' }

export const initialUpdateState: UpdateState = { phase: 'idle' }

/** Wording per ruling 5: which phase failed decides the heading. */
export function errorHeading(failed: 'check' | 'download' | 'install'): string {
  switch (failed) {
    case 'check':
      return 'Update check failed'
    case 'download':
      return 'Download failed'
    case 'install':
      return 'The update was not installed'
  }
}

/**
 * What the Retry button should do from an error state.
 *
 * A `download`/`install` failure normally carries the `UpdateInfo` it failed
 * on, so retrying means going back to `available` and downloading again
 * (Task 2 guarantees a stale download can't be reused). But a `service-error`
 * can also land the machine in `error` from a state that never carried info
 * (e.g. an install error arriving while the surface was still `idle` or
 * `checking`) — in that case there's nothing to re-download, so the only
 * sensible retry is a fresh check.
 */
export function retryAction(state: UpdateState): 'check' | 'download' | 'none' {
  if (state.phase !== 'error') return 'none'
  if (state.failed === 'check') return 'check'
  return state.info ? 'download' : 'check'
}

export function reduceUpdateState(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'check-start':
      return { phase: 'checking' }

    case 'check-ok':
      return event.info ? { phase: 'available', info: event.info } : { phase: 'up-to-date' }

    case 'check-fail':
      return { phase: 'error', failed: 'check', message: event.message, info: null }

    case 'download-start':
      if (state.phase !== 'available') return state
      return { phase: 'downloading', info: state.info, progress: 0 }

    case 'progress':
      // Ruling 2: applied only in `downloading` — a late-arriving progress
      // event can't resurrect the bar after the download finished or errored.
      if (state.phase !== 'downloading') return state
      return { phase: 'downloading', info: state.info, progress: event.percent }

    case 'download-ok':
      if (state.phase !== 'downloading') return state
      return { phase: 'ready', info: state.info }

    case 'download-fail':
      if (state.phase !== 'downloading') return state
      return { phase: 'error', failed: 'download', message: event.message, info: state.info }

    case 'install-start':
      // Ruling 4: only from `ready` — every button is disabled in `installing`
      // and there is no success transition (the app quits on success).
      if (state.phase !== 'ready') return state
      return { phase: 'installing', info: state.info }

    case 'install-fail':
      if (state.phase !== 'installing') return state
      return { phase: 'error', failed: 'install', message: event.message, info: state.info }

    case 'service-error': {
      // Ruling 3: a `service-error` with `phase === 'install'` moves ANY
      // state to `error` — it is how a cancelled password prompt arrives,
      // asynchronously, after `install-start` already resolved the IPC call.
      //
      // `check`/`download` errors are NOT applied unconditionally, unlike
      // `install`: main broadcasts a `check`-phase error for any updater
      // error that happens outside an active download/install (e.g. the
      // tray popover polls on every open), so a surface that is sitting in
      // `ready`/`available` — nothing to do with that check — must not be
      // flipped into an error over it. Likewise a `download`-phase error
      // belongs only to the surface whose own download is in flight; a
      // download failure that started on another surface must not clobber
      // this one. Only `install` has no other surface to attribute it to:
      // there is exactly one install in flight app-wide (Task 2's guard),
      // so it is always this surface's concern.
      if (event.error.phase === 'check' && state.phase !== 'checking') return state
      if (event.error.phase === 'download' && state.phase !== 'downloading') return state
      const info = 'info' in state ? state.info : null
      return {
        phase: 'error',
        failed: event.error.phase,
        message: event.error.message,
        hint: event.error.hint,
        info,
      }
    }

    case 'retry': {
      if (state.phase !== 'error') return state
      const action = retryAction(state)
      if (action === 'download') return { phase: 'available', info: state.info as UpdateInfo }
      return { phase: 'idle' }
    }

    default:
      return state
  }
}

/**
 * Payload shape carried by `CHANNELS.PUSH_SHOW_UPDATE` and by the query
 * params `window-manager.ts` encodes on a fresh update window (see
 * `createOrShowUpdateWindow`). Both a first paint (`parseFromUrl`) and a
 * reused-window push (`PUSH_SHOW_UPDATE`) go through this same mapping so a
 * cancelled install — which reopens the update window with `updateError` set
 * — renders identically however the state got there.
 */
export interface ShowUpdatePayload {
  updateInfo?: UpdateInfo | null
  errorMessage?: string | null
  updateError?: UpdateServiceError | null
}

/**
 * Maps a `PUSH_SHOW_UPDATE` payload (or the equivalent query params on
 * first paint) to the initial `UpdateState` a surface should render.
 *
 * `updateError` wins over `errorMessage`: `updateError` is the structured
 * report from `update-service.ts` (it knows which phase failed and carries
 * an optional hint), while `errorMessage` is the older, plain-string shape
 * used only for a failed *check* — so an `errorMessage` always maps to
 * `failed: 'check'`.
 */
export function stateFromShowUpdate(payload: ShowUpdatePayload): UpdateState {
  if (payload.updateError) {
    return {
      phase: 'error',
      failed: payload.updateError.phase,
      message: payload.updateError.message,
      hint: payload.updateError.hint,
      info: payload.updateInfo ?? null,
    }
  }
  if (payload.errorMessage) {
    return { phase: 'error', failed: 'check', message: payload.errorMessage, info: null }
  }
  if (payload.updateInfo === undefined) return { phase: 'checking' }
  return payload.updateInfo
    ? { phase: 'available', info: payload.updateInfo }
    : { phase: 'up-to-date' }
}

/**
 * Decides what a `PUSH_SHOW_UPDATE` push should do to a surface's *current*
 * state, as opposed to `stateFromShowUpdate` which only knows how to build a
 * state from scratch.
 *
 * `createOrShowUpdateWindow` sends this push every time the update window is
 * reused — including when the tray's "Check for Updates" runs a fresh check
 * while the window is already open and, say, mid-download. Blindly replacing
 * state with `stateFromShowUpdate(payload)` in that case would revert an
 * in-progress `downloading` back to `available` (dropping every subsequent
 * `progress`/`download-ok`), would drop a finished `ready` download, and —
 * worst of all — would un-disable every button in `installing`, undoing the
 * double-install guard.
 *
 * An `updateError` always wins regardless of the current phase: it's the
 * path by which a cancelled install becomes visible, including in the
 * unusual case where the window is still around to receive it directly. A
 * plain check result (no `updateError`), however, must never interrupt an
 * in-flight `downloading`, a finished `ready`, or an `installing` — those
 * three keep their current state untouched.
 */
export function applyShowUpdate(current: UpdateState, payload: ShowUpdatePayload): UpdateState {
  if (payload.updateError) return stateFromShowUpdate(payload)
  if (
    current.phase === 'downloading' ||
    current.phase === 'ready' ||
    current.phase === 'installing'
  ) {
    return current
  }
  return stateFromShowUpdate(payload)
}
