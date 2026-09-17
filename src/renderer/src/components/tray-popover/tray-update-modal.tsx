import React, { useEffect, useState, useReducer } from 'react'
import { Download, Zap, CheckCircle, AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import type { UpdateInfo, UpdateServiceError } from '@shared/types/project'
import {
  applyShowUpdate,
  errorHeading,
  initialUpdateState,
  reduceUpdateState,
  retryAction,
  type ShowUpdatePayload,
  type UpdateEvent,
  type UpdateState,
} from '@shared/update-state'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import { cn } from '@renderer/lib/cn'

function UpToDate({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
        <CheckCircle className="h-6 w-6 text-green-500" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold">You&apos;re up to date!</p>
        <p className="text-xs text-muted-foreground mt-0.5">ClaudeWatch has no pending updates.</p>
      </div>
      <Button size="sm" variant="outline" className="w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  )
}

function ErrorView({
  state,
  onRetry,
  onClose,
}: {
  state: Extract<UpdateState, { phase: 'error' }>
  onRetry: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{errorHeading(state.failed)}</p>
          <p className="text-destructive/80">{state.message}</p>
        </div>
      </div>
      {state.hint && (
        <pre className="rounded bg-muted p-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">
          {state.hint}
        </pre>
      )}
      <Button variant="outline" size="sm" className="w-full" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
      <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>
        Close
      </Button>
    </div>
  )
}

function UpdateAvailable({
  info,
  update,
  onDownload,
  onInstall,
  onClose,
}: {
  info: UpdateInfo
  update: Extract<UpdateState, { phase: 'available' | 'downloading' | 'ready' | 'installing' }>
  onDownload: () => void
  onInstall: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {/* Version badge */}
      <div className="flex items-center gap-3 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">v{info.version} is available</p>
          {info.releaseDate && (
            <p className="text-[11px] text-muted-foreground">
              {new Date(info.releaseDate).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          )}
        </div>
      </div>

      {/* Release notes */}
      {info.releaseNotes && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2.5 max-h-52 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            What&apos;s new
          </p>
          <MarkdownRenderer content={info.releaseNotes} className="text-xs" />
        </div>
      )}

      {/* Actions */}
      {update.phase === 'available' && (
        <Button size="sm" className="w-full" onClick={onDownload}>
          <Download className="h-4 w-4" />
          Download &amp; Install
        </Button>
      )}

      {update.phase === 'downloading' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Downloading…
          </div>
          <Progress value={update.progress} className="h-1.5" />
        </div>
      )}

      {update.phase === 'ready' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="h-3.5 w-3.5" />
            Downloaded — ready to install
          </div>
          <Button size="sm" className="w-full" onClick={onInstall}>
            <Zap className="h-4 w-4" />
            Install &amp; Restart
          </Button>
        </div>
      )}

      {update.phase === 'installing' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Installing…
          </div>
          <Button size="sm" className="w-full" disabled>
            <Zap className="h-4 w-4" />
            Install &amp; Restart
          </Button>
        </div>
      )}

      {update.phase !== 'installing' && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={onClose}
        >
          Later
        </Button>
      )}
    </div>
  )
}

/**
 * Same reasoning as `update-window.tsx`'s `windowReducer`: `PUSH_SHOW_UPDATE`
 * fires every time this modal's check runs (e.g. re-opening the tray
 * popover), including while a download or install started from this same
 * modal is still in flight. Dispatching a plain `check-ok`/`check-fail`
 * straight from the payload would blindly reset that in-progress state —
 * `applyShowUpdate` keeps `downloading`/`ready`/`installing` untouched
 * unless the payload carries an `updateError`, which always wins.
 */
type ModalEvent = UpdateEvent | { type: 'hydrate'; payload: ShowUpdatePayload }

function modalReducer(state: UpdateState, event: ModalEvent): UpdateState {
  if (event.type === 'hydrate') return applyShowUpdate(state, event.payload)
  return reduceUpdateState(state, event)
}

export function TrayUpdateModal(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [update, dispatch] = useReducer(modalReducer, initialUpdateState)

  // Handle the reused-window-style push: the popover was already open and
  // receives fresh check data (updateInfo), a plain check failure
  // (errorMessage → always failed: 'check'), or — the path by which a
  // cancelled install becomes visible — a structured updateError.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.claudewatch) return
    const unsub = ipc.on<{
      updateInfo: UpdateInfo | null
      errorMessage?: string
      updateError?: UpdateServiceError
    }>(CHANNELS.PUSH_SHOW_UPDATE, (payload) => {
      dispatch({ type: 'hydrate', payload })
      setOpen(true)
    })
    return unsub
  }, [])

  // A service-level error — most importantly a cancelled install's password
  // prompt, which arrives asynchronously after `install-start` already
  // resolved the install IPC call — always wins over whatever this modal was
  // doing (ruling 3), and must reopen the modal if it had been dismissed.
  useEffect(() => {
    return ipc.on<UpdateServiceError>(CHANNELS.PUSH_UPDATE_SERVICE_ERROR, (error) => {
      dispatch({ type: 'service-error', error })
      setOpen(true)
    })
  }, [])

  useEffect(() => {
    return ipc.on<{ percent: number }>(CHANNELS.PUSH_UPDATE_DOWNLOAD_PROGRESS, ({ percent }) => {
      dispatch({ type: 'progress', percent })
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
      // On success this popover goes away with the app — there is no success
      // state to render here.
    } catch (err) {
      dispatch({ type: 'install-fail', message: String(err) })
    }
  }

  function handleRetry(): void {
    if (update.phase !== 'error') return
    const action = retryAction(update)
    dispatch({ type: 'retry' })
    if (action === 'download') {
      void handleDownload()
    } else if (action === 'check') {
      void handleCheck()
    }
  }

  function handleClose(): void {
    setOpen(false)
  }

  const info = 'info' in update ? update.info : null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100vw-24px)] max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'
          )}
        >
          <DialogPrimitive.Title className="text-sm font-semibold mb-4">
            ClaudeWatch Updates
          </DialogPrimitive.Title>

          {update.phase === 'error' ? (
            <ErrorView state={update} onRetry={handleRetry} onClose={handleClose} />
          ) : info ? (
            <UpdateAvailable
              info={info}
              update={
                update as Extract<
                  UpdateState,
                  { phase: 'available' | 'downloading' | 'ready' | 'installing' }
                >
              }
              onDownload={handleDownload}
              onInstall={handleInstall}
              onClose={handleClose}
            />
          ) : (
            <UpToDate onClose={handleClose} />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
