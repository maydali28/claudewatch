import React, { useState, useEffect } from 'react'
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
import { AppLinks } from '@renderer/lib/app-links'
import type { UpdateInfo } from '@shared/types'
import appIcon from '@renderer/assets/claudewatch-ring.svg'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date' }
  | { phase: 'available'; info: UpdateInfo }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready' }
  | { phase: 'brew-launched' }
  | { phase: 'error'; message: string }

export default function AboutPanel(): React.JSX.Element {
  const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' })
  const [appVersion, setAppVersion] = useState<string>('…')

  useEffect(() => {
    ipc.app.getVersion().then((result) => {
      if (result.ok) setAppVersion(result.data)
    })
  }, [])

  async function handleCheckUpdates(): Promise<void> {
    setUpdate({ phase: 'checking' })
    try {
      const result = await ipc.updates.check()
      if (result.ok) {
        if (result.data) {
          setUpdate({ phase: 'available', info: result.data })
        } else {
          setUpdate({ phase: 'up-to-date' })
        }
      } else {
        setUpdate({ phase: 'error', message: result.error })
      }
    } catch (err) {
      setUpdate({ phase: 'error', message: String(err) })
    }
  }

  async function handleBrewUpgrade(): Promise<void> {
    const result = await ipc.updates.brewUpgrade()
    if (result.ok) {
      setUpdate({ phase: 'brew-launched' })
    } else {
      setUpdate({ phase: 'error', message: result.error })
    }
  }

  async function handleDownload(): Promise<void> {
    setUpdate({ phase: 'downloading', progress: 0 })
    try {
      const result = await ipc.updates.download()
      if (result.ok) {
        setUpdate({ phase: 'ready' })
      } else {
        setUpdate({ phase: 'error', message: result.error })
      }
    } catch (err) {
      setUpdate({ phase: 'error', message: String(err) })
    }
  }

  async function handleInstall(): Promise<void> {
    await ipc.updates.install()
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
            {update.info.isMacBrew ? (
              <Button size="sm" onClick={handleBrewUpgrade}>
                <ExternalLink className="h-4 w-4" />
                Upgrade via Homebrew
              </Button>
            ) : (
              <Button size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4" />
                Download update
              </Button>
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

        {update.phase === 'brew-launched' && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle className="h-4 w-4" />
            Terminal opened — follow Homebrew&apos;s instructions to complete.
          </div>
        )}

        {update.phase === 'error' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {update.message}
            </div>
            <Button variant="outline" size="sm" onClick={handleCheckUpdates}>
              <RefreshCw className="h-4 w-4" />
              Try again
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
