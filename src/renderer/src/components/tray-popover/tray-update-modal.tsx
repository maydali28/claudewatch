import React, { useEffect, useState } from 'react'
import {
  Download,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import type { UpdateInfo } from '@shared/types/project'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import { cn } from '@renderer/lib/cn'

type DownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

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

function UpdateAvailable({
  info,
  onClose,
}: {
  info: UpdateInfo
  onClose: () => void
}): React.JSX.Element {
  const [dl, setDl] = useState<DownloadState>({ phase: 'idle' })

  async function handleBrewUpgrade(): Promise<void> {
    const result = await ipc.updates.brewUpgrade()
    if (result.ok) {
      onClose()
    } else {
      setDl({ phase: 'error', message: result.error })
    }
  }

  async function handleDownload(): Promise<void> {
    setDl({ phase: 'downloading', progress: 0 })
    try {
      const result = await ipc.updates.download()
      if (result.ok) {
        setDl({ phase: 'ready' })
      } else {
        setDl({ phase: 'error', message: result.error })
      }
    } catch (err) {
      setDl({ phase: 'error', message: String(err) })
    }
  }

  async function handleInstall(): Promise<void> {
    await ipc.updates.install()
  }

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
      {dl.phase === 'idle' &&
        (info.isMacBrew ? (
          <Button size="sm" className="w-full" onClick={handleBrewUpgrade}>
            <ExternalLink className="h-4 w-4" />
            Upgrade via Homebrew
          </Button>
        ) : (
          <Button size="sm" className="w-full" onClick={handleDownload}>
            <Download className="h-4 w-4" />
            Download &amp; Install
          </Button>
        ))}

      {dl.phase === 'downloading' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Downloading…
          </div>
          <Progress value={dl.progress} className="h-1.5" />
        </div>
      )}

      {dl.phase === 'ready' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="h-3.5 w-3.5" />
            Downloaded — ready to install
          </div>
          <Button size="sm" className="w-full" onClick={handleInstall}>
            <Zap className="h-4 w-4" />
            Install &amp; Restart
          </Button>
        </div>
      )}

      {dl.phase === 'error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {dl.message}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setDl({ phase: 'idle' })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      )}

      <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>
        Later
      </Button>
    </div>
  )
}

export function TrayUpdateModal(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.claudewatch) return
    const unsub = ipc.on<UpdateInfo | null>(CHANNELS.PUSH_SHOW_UPDATE, (info) => {
      setUpdateInfo(info)
      setOpen(true)
    })
    return unsub
  }, [])

  function handleClose(): void {
    setOpen(false)
  }

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

          {updateInfo === null ? (
            <UpToDate onClose={handleClose} />
          ) : (
            <UpdateAvailable info={updateInfo} onClose={handleClose} />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
