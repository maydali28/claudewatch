import React, { useEffect, useState } from 'react'
import { ExternalLink, Globe } from 'lucide-react'
import { ipc } from '@renderer/lib/ipc-client'
import { AppLinks } from '@renderer/lib/app-links'
import { Button } from '@renderer/components/ui/button'
import appIcon from '@renderer/assets/claudewatch-ring.svg'

export default function AboutWindow(): React.JSX.Element {
  const [version, setVersion] = useState('…')

  useEffect(() => {
    ipc.app.getVersion().then((r) => {
      if (r.ok) setVersion(r.data)
    })
  }, [])

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      {/* macOS traffic-light drag area */}
      <div className="h-8 shrink-0 [-webkit-app-region:drag]" />

      <div className="flex flex-col items-center gap-5 px-8 pb-8 flex-1 justify-center min-h-0">
        <img src={appIcon} alt="ClaudeWatch" className="h-16 w-16 rounded-2xl" />

        <div className="text-center">
          <h1 className="text-lg font-bold">ClaudeWatch</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Version {version}</p>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-xs">
            Monitor your Claude Code sessions, token usage, and costs in real time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={AppLinks.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent"
          >
            <Globe className="h-3.5 w-3.5" />
            Website
          </a>
          <a
            href={AppLinks.repo}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>

        <div className="w-full border-t border-border/60 pt-4 space-y-1 text-xs text-muted-foreground text-center">
          <p>Data source: ~/.claude/ (read-only)</p>
          <p>© {new Date().getFullYear()} Mohamed Ali May · MIT License</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.close()}>
            Close
          </Button>
          <Button variant="ghost" size="sm" onClick={() => ipc.tray.showUpdate()}>
            <ExternalLink className="h-3.5 w-3.5" />
            Check for updates
          </Button>
        </div>
      </div>
    </div>
  )
}
