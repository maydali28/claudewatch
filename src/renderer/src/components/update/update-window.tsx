import React, { useEffect, useState } from 'react'
import {
  Download,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import type { UpdateInfo } from '@shared/types/project'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import appIcon from '@renderer/assets/claudewatch-ring.svg'

type DownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

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

function UpdateAvailable({ info }: { info: UpdateInfo }): React.JSX.Element {
  const [dl, setDl] = useState<DownloadState>({ phase: 'idle' })

  async function handleBrewUpgrade(): Promise<void> {
    const result = await ipc.updates.brewUpgrade()
    if (result.ok) {
      window.close()
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
    <div className="flex flex-col gap-5">
      {/* Release notes */}
      {info.releaseNotes && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 flex-1 overflow-y-auto max-h-64">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            What&apos;s new
          </p>
          <MarkdownRenderer content={info.releaseNotes} className="text-sm" />
        </div>
      )}

      {/* Actions */}
      {dl.phase === 'idle' && (
        <div className="flex flex-col gap-2">
          {info.isMacBrew ? (
            <Button className="w-full" onClick={handleBrewUpgrade}>
              <ExternalLink className="h-4 w-4" />
              Upgrade via Homebrew
            </Button>
          ) : (
            <Button className="w-full" onClick={handleDownload}>
              <Download className="h-4 w-4" />
              Download &amp; Install
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => window.close()}
          >
            Later
          </Button>
        </div>
      )}

      {dl.phase === 'downloading' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Downloading update…
          </div>
          <Progress value={dl.progress} className="h-1.5" />
        </div>
      )}

      {dl.phase === 'ready' && (
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

      {dl.phase === 'error' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {dl.message}
          </div>
          <Button variant="outline" className="w-full" onClick={() => setDl({ phase: 'idle' })}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

function parseFromUrl(): { updateInfo: UpdateInfo | null; errorMessage: string | null } {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('updateInfo')
  const errorMessage = params.get('errorMessage') ?? null
  let updateInfo: UpdateInfo | null = null
  if (raw) {
    try {
      updateInfo = JSON.parse(raw)
    } catch {
      /* ignore */
    }
  }
  return { updateInfo, errorMessage }
}

export default function UpdateWindow(): React.JSX.Element {
  const initial = parseFromUrl()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null | undefined>(
    initial.errorMessage ? undefined : initial.updateInfo
  )
  const [fetchError, setFetchError] = useState<string | null>(initial.errorMessage)

  // Handle re-focus case where the window is already open and receives new data
  useEffect(() => {
    if (typeof window === 'undefined' || !window.claudewatch) return
    const unsub = ipc.on<{ updateInfo: UpdateInfo | null; errorMessage?: string }>(
      CHANNELS.PUSH_SHOW_UPDATE,
      (payload) => {
        setFetchError(payload.errorMessage ?? null)
        setUpdateInfo(payload.errorMessage ? undefined : payload.updateInfo)
      }
    )
    return unsub
  }, [])

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      {/* Title bar area for macOS traffic lights */}
      <div className="h-8 shrink-0 [-webkit-app-region:drag]" />

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* App header */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src={appIcon} alt="ClaudeWatch" className="h-16 w-16 rounded-2xl" />
          <div className="text-center">
            <h1 className="text-lg font-bold">ClaudeWatch</h1>
            {updateInfo != null ? (
              <>
                <p className="text-sm font-medium text-primary mt-0.5">
                  Version {updateInfo.version} available
                </p>
                {updateInfo.releaseDate && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Released{' '}
                    {new Date(updateInfo.releaseDate).toLocaleDateString(undefined, {
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

        {fetchError && (
          <div className="flex flex-col items-center gap-5 py-4">
            <div className="text-center">
              <p className="text-base font-semibold text-destructive">Update check failed</p>
              <p className="text-sm text-destructive/80 mt-1">{fetchError}</p>
            </div>
            <Button variant="outline" onClick={() => window.close()}>
              Close
            </Button>
          </div>
        )}

        {!fetchError && updateInfo === undefined && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for updates…
          </div>
        )}

        {!fetchError && updateInfo === null && <UpToDate />}
        {!fetchError && updateInfo != null && <UpdateAvailable info={updateInfo} />}
      </div>
    </div>
  )
}
