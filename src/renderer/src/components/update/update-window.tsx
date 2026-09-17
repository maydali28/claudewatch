import React, { useEffect, useReducer, useRef } from 'react'
import { Download, Zap, CheckCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import type { UpdateInfo, UpdateServiceError } from '@shared/types/project'
import {
  applyShowUpdate,
  errorHeading,
  reduceUpdateState,
  retryAction,
  stateFromShowUpdate,
  type ShowUpdatePayload,
  type UpdateEvent,
  type UpdateState,
} from '@shared/update-state'
import { clampUpdateWindowHeight } from '@shared/utils/update-window-size'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import appIcon from '@renderer/assets/claudewatch-ring.svg'

function UpToDate(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-5 py-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
        <CheckCircle className="h-8 w-8 text-green-500" />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold">You&apos;re up to date!</p>
        <p className="text-sm text-muted-foreground mt-1">ClaudeWatch has no pending updates.</p>
      </div>
      <Button variant="outline" onClick={() => window.close()}>
        Close
      </Button>
    </div>
  )
}

function ErrorView({
  state,
  onRetry,
}: {
  state: Extract<UpdateState, { phase: 'error' }>
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-5 py-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-destructive">{errorHeading(state.failed)}</p>
        <p className="text-sm text-destructive/80 mt-1">{state.message}</p>
        {state.hint && (
          <pre className="mt-3 max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-left text-xs font-mono text-muted-foreground whitespace-pre-wrap">
            {state.hint}
          </pre>
        )}
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button className="w-full" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => window.close()}
        >
          Close
        </Button>
      </div>
    </div>
  )
}

function UpdateAvailable({
  info,
  onDownload,
}: {
  info: UpdateInfo
  onDownload: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      {/* Release notes */}
      {info.releaseNotes && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 flex-1 overflow-y-auto max-h-80">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            What&apos;s new
          </p>
          <MarkdownRenderer content={info.releaseNotes} className="text-sm" />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button className="w-full" onClick={onDownload}>
          <Download className="h-4 w-4" />
          Download &amp; Install
        </Button>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => window.close()}
        >
          Later
        </Button>
      </div>
    </div>
  )
}

function parseFromUrl(): {
  updateInfo?: UpdateInfo | null
  errorMessage?: string | null
  updateError?: UpdateServiceError
} {
  const params = new URLSearchParams(window.location.search)
  const rawInfo = params.get('updateInfo')
  const rawError = params.get('updateError')
  const errorMessage = params.get('errorMessage') ?? undefined

  let updateInfo: UpdateInfo | null | undefined
  if (rawInfo !== null) {
    try {
      updateInfo = JSON.parse(rawInfo)
    } catch {
      /* ignore */
    }
  }

  let updateError: UpdateServiceError | undefined
  if (rawError) {
    try {
      updateError = JSON.parse(rawError)
    } catch {
      /* ignore */
    }
  }

  return { updateInfo, errorMessage, updateError }
}

/**
 * A `PUSH_SHOW_UPDATE` push (the reused-window path) carries a full payload
 * that needs a *decision*, not just a mapping: `applyShowUpdate` keeps this
 * window's current state untouched when it is `downloading`, `ready` or
 * `installing` (the window is reused every time the tray runs "Check for
 * Updates", including while a download or install is already under way — see
 * `applyShowUpdate`'s doc comment), and otherwise defers to
 * `stateFromShowUpdate`, whose `updateError` case sets `info` from the
 * payload rather than from whatever this window's *current* phase happens to
 * be (a window sitting idle can be reopened straight into `error` with the
 * failed install's info attached). `reduceUpdateState`'s own `service-error`
 * case instead derives `info` from the current state, which is correct for a
 * live `PUSH_UPDATE_SERVICE_ERROR` broadcast but not for this
 * replace-or-keep push. `hydrate` lets this window run that decision against
 * its live state (read inside the reducer, never a stale closure) without
 * adding a component-specific variant to the shared `UpdateEvent` union.
 */
type WindowEvent = UpdateEvent | { type: 'hydrate'; payload: ShowUpdatePayload }

function windowReducer(state: UpdateState, event: WindowEvent): UpdateState {
  if (event.type === 'hydrate') return applyShowUpdate(state, event.payload)
  return reduceUpdateState(state, event)
}

/**
 * Measures the window's root element and asks main to size the window's
 * content to fit — a content-sized dialog beats a fixed 520×640 that's mostly
 * empty for the common "you're up to date" case, or too short for long
 * release notes. Debounced 50 ms so a burst of layout changes (e.g. a phase
 * transition that swaps in a taller view) doesn't spam the IPC channel, and
 * only sent when the clamped value actually changed so settling back on the
 * same height after a debounce window is a no-op.
 */
function useFitWindowToContent(ref: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = -1
    let timer: ReturnType<typeof setTimeout> | null = null
    const request = (): void => {
      const next = clampUpdateWindowHeight(el.scrollHeight)
      if (next === last) return
      last = next
      void ipc.updates.resizeWindow(next)
    }
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(request, 50)
    })
    ro.observe(el)
    request()
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [ref])
}

export default function UpdateWindow(): React.JSX.Element {
  const [state, dispatch] = useReducer(windowReducer, undefined, () =>
    stateFromShowUpdate(parseFromUrl())
  )
  const rootRef = useRef<HTMLDivElement>(null)
  useFitWindowToContent(rootRef)

  // Reflect electron-updater's download-progress events in the bar.
  useEffect(() => {
    return ipc.on<{ percent: number }>(CHANNELS.PUSH_UPDATE_DOWNLOAD_PROGRESS, ({ percent }) => {
      dispatch({ type: 'progress', percent })
    })
  }, [])

  // A service-level error (most importantly: a cancelled install's password
  // prompt, which arrives asynchronously after `install-start` already
  // resolved the install IPC call) always wins over whatever this surface
  // was doing.
  useEffect(() => {
    return ipc.on<UpdateServiceError>(CHANNELS.PUSH_UPDATE_SERVICE_ERROR, (error) => {
      dispatch({ type: 'service-error', error })
    })
  }, [])

  // Handle re-focus case where the window is already open and receives new data.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.claudewatch) return
    return ipc.on<{
      updateInfo: UpdateInfo | null
      errorMessage?: string
      updateError?: UpdateServiceError
    }>(CHANNELS.PUSH_SHOW_UPDATE, (payload) => {
      dispatch({ type: 'hydrate', payload })
    })
  }, [])

  async function handleCheck(): Promise<void> {
    dispatch({ type: 'check-start' })
    try {
      const result = await ipc.updates.check()
      if (result.ok) {
        dispatch({ type: 'check-ok', info: result.data })
      } else {
        dispatch({ type: 'check-fail', message: result.error })
      }
    } catch (err) {
      dispatch({ type: 'check-fail', message: String(err) })
    }
  }

  async function handleDownload(): Promise<void> {
    dispatch({ type: 'download-start' })
    try {
      const result = await ipc.updates.download()
      if (result.ok) {
        dispatch({ type: 'download-ok' })
      } else {
        dispatch({ type: 'download-fail', message: result.error })
      }
    } catch (err) {
      dispatch({ type: 'download-fail', message: String(err) })
    }
  }

  async function handleInstall(): Promise<void> {
    dispatch({ type: 'install-start' })
    try {
      const result = await ipc.updates.install()
      if (!result.ok) {
        dispatch({ type: 'install-fail', message: result.error })
      }
      // On success this window goes away with the app — there is no success
      // transition to make here.
    } catch (err) {
      dispatch({ type: 'install-fail', message: String(err) })
    }
  }

  function handleRetry(): void {
    if (state.phase !== 'error') return
    const action = retryAction(state)
    dispatch({ type: 'retry' })
    if (action === 'download') {
      void handleDownload()
    } else if (action === 'check') {
      void handleCheck()
    }
  }

  const info = 'info' in state ? state.info : null

  return (
    <div ref={rootRef} className="flex flex-col bg-background text-foreground">
      {/* Title bar area for macOS traffic lights */}
      <div className="h-8 shrink-0 [-webkit-app-region:drag]" />

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* App header */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src={appIcon} alt="ClaudeWatch" className="h-16 w-16 rounded-2xl" />
          <div className="text-center">
            <h1 className="text-lg font-bold">ClaudeWatch</h1>
            {info != null ? (
              <>
                <p className="text-sm font-medium text-primary mt-0.5">
                  Version {info.version} available
                </p>
                {info.releaseDate && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Released{' '}
                    {new Date(info.releaseDate).toLocaleDateString(undefined, {
                      dateStyle: 'long',
                    })}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Updates</p>
            )}
          </div>
        </div>

        {state.phase === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for updates…
          </div>
        )}

        {state.phase === 'up-to-date' && <UpToDate />}

        {state.phase === 'available' && (
          <UpdateAvailable info={state.info} onDownload={handleDownload} />
        )}

        {state.phase === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Downloading update…
            </div>
            <Progress value={state.progress} className="h-1.5" />
          </div>
        )}

        {state.phase === 'ready' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              Downloaded — ready to install
            </div>
            <Button className="w-full" onClick={handleInstall}>
              <Zap className="h-4 w-4" />
              Install &amp; Restart
            </Button>
          </div>
        )}

        {state.phase === 'installing' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Installing…
            </div>
            <Button className="w-full" disabled>
              <Zap className="h-4 w-4" />
              Install &amp; Restart
            </Button>
          </div>
        )}

        {state.phase === 'error' && <ErrorView state={state} onRetry={handleRetry} />}
      </div>
    </div>
  )
}
