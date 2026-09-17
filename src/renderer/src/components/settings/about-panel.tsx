import React, { useState, useEffect, useReducer } from 'react'
import {
  RefreshCw,
  Download,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Globe,
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { ipc } from '@renderer/lib/ipc-client'
import { CHANNELS } from '@shared/ipc/channels'
import { AppLinks } from '@renderer/lib/app-links'
import type { UpdateServiceError } from '@shared/types'
import {
  errorHeading,
  initialUpdateState,
  reduceUpdateState,
  retryAction,
} from '@shared/update-state'
import { canInstallInApp, MANUAL_UPDATE_COMMAND } from '@shared/utils/update-install-support'
import appIcon from '@renderer/assets/claudewatch-ring.svg'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'

export default function AboutPanel(): React.JSX.Element {
  const [update, dispatch] = useReducer(reduceUpdateState, initialUpdateState)
  const [appVersion, setAppVersion] = useState<string>('…')

  useEffect(() => {
    ipc.app.getVersion().then((result) => {
      if (result.ok) setAppVersion(result.data)
    })
  }, [])

  // Reflect electron-updater's download-progress events in the bar. Ruling 2:
  // the reducer only applies this while actively downloading, so a late-
  // arriving event can't resurrect the bar after the download finished or
  // errored.
  useEffect(() => {
    return ipc.on<{ percent: number }>(CHANNELS.PUSH_UPDATE_DOWNLOAD_PROGRESS, ({ percent }) => {
      dispatch({ type: 'progress', percent })
    })
  }, [])

  // A service-level error — most importantly a cancelled install's password
  // prompt, which arrives asynchronously after `install-start` already
  // resolved the install IPC call — always wins over whatever this panel was
  // doing (ruling 3).
  useEffect(() => {
    return ipc.on<UpdateServiceError>(CHANNELS.PUSH_UPDATE_SERVICE_ERROR, (error) => {
      dispatch({ type: 'service-error', error })
    })
  }, [])

  async function handleCheckUpdates(): Promise<void> {
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
    // The result was previously discarded, so a failed install looked exactly
    // like a successful one: the button did nothing and said nothing.
    //
    // On success this panel goes away with the app, so there is no success
    // state to render — anything we get back here means the install did not
    // start.
    dispatch({ type: 'install-start' })
    try {
      const result = await ipc.updates.install()
      if (!result.ok) {
        dispatch({ type: 'install-fail', message: result.error })
      }
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
      void handleCheckUpdates()
    }
  }

  return (
    <div className="space-y-6">
      {/* App identity */}
      <div className="flex items-center gap-4 rounded-lg border p-5">
        <img src={appIcon} alt="ClaudeWatch" className="h-12 w-12 rounded-xl" />
        <div>
          <h2 className="text-lg font-bold">Claudewatch</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-sm text-muted-foreground">Version {appVersion}</p>
            {update.phase === 'available' && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-inset ring-primary/20">
                NEW v{update.info.version}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitor your Claude Code sessions, token usage, and costs in real time.
          </p>
        </div>
      </div>

      {/* Updates */}
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-semibold">Updates</h3>

        {update.phase === 'idle' && (
          <Button variant="outline" size="sm" onClick={handleCheckUpdates}>
            <RefreshCw className="h-4 w-4" />
            Check for updates
          </Button>
        )}

        {update.phase === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for updates…
          </div>
        )}

        {update.phase === 'up-to-date' && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle className="h-4 w-4" />
            You&apos;re on the latest version.
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCheckUpdates}
              className="ml-auto h-7 px-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {update.phase === 'available' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              Version {update.info.version} is available
            </div>
            {update.info.releaseNotes && (
              <div className="rounded bg-muted p-2 max-h-48 overflow-y-auto">
                <MarkdownRenderer content={update.info.releaseNotes} className="text-xs" />
              </div>
            )}
            {/* Linux has no in-app installer: electron-updater is never given
                a pending update there, so this button could only ever fail
                with its own "Please check update first". */}
            {canInstallInApp(ipc.platform) ? (
              <Button size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4" />
                Download update
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Update with{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                    {MANUAL_UPDATE_COMMAND}
                  </code>
                  , or download the new package.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(AppLinks.releases, '_blank', 'noopener')}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open the releases page
                </Button>
              </div>
            )}
          </div>
        )}

        {update.phase === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Downloading update…
            </div>
            <Progress value={update.progress} className="h-1.5" />
          </div>
        )}

        {update.phase === 'ready' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              Update downloaded. Restart to apply.
            </div>
            <Button size="sm" onClick={handleInstall}>
              <Zap className="h-4 w-4" />
              Install &amp; Restart
            </Button>
          </div>
        )}

        {update.phase === 'installing' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Installing…
            </div>
            <Button size="sm" disabled>
              <Zap className="h-4 w-4" />
              Install &amp; Restart
            </Button>
          </div>
        )}

        {update.phase === 'error' && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{errorHeading(update.failed)}</p>
                <p className="text-destructive/80">{update.message}</p>
              </div>
            </div>
            {update.hint && (
              <pre className="rounded bg-muted p-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">
                {update.hint}
              </pre>
            )}
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}
      </div>

      {/* Links */}
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-semibold">Links</h3>
        <div className="flex flex-col gap-2">
          <a
            href={AppLinks.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:opacity-80"
          >
            <Globe className="h-4 w-4" />
            <span className="underline underline-offset-2">
              {AppLinks.website.replace('https://', '')}
            </span>
          </a>
          <a
            href={AppLinks.repo}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:opacity-80"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="underline underline-offset-2">
              {AppLinks.repo.replace('https://', '')}
            </span>
          </a>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        <p>Session data is read-only — no writes to ~/.claude/</p>
      </div>
    </div>
  )
}
