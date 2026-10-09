import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ipc } from '@renderer/lib/ipc-client'
import { ipcCall } from '@renderer/lib/ipc-call'
import { useClaudePaths } from '@renderer/hooks/use-claude-paths'
import type { ClaudeDirInspection, ClaudeDirSource } from '@shared/types'

/** How long typing pauses before the folder is checked. */
const INSPECT_DELAY_MS = 300

function sourceText(source: ClaudeDirSource): string {
  switch (source) {
    case 'app-setting':
      return 'Chosen here.'
    case 'env':
      return 'From CLAUDE_CONFIG_DIR in the environment ClaudeWatch was started from.'
    case 'user-settings':
      return 'From CLAUDE_CONFIG_DIR in ~/.claude/settings.json.'
    case 'default':
      return 'The default location.'
  }
}

function InspectionLine({ inspection }: { inspection: ClaudeDirInspection }): React.JSX.Element {
  if (!inspection.exists) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" /> This folder does not exist.
      </p>
    )
  }
  if (!inspection.isDirectory) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" /> This is a file, not a folder.
      </p>
    )
  }
  if (!inspection.looksLikeClaudeDir) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5" /> No projects folder or settings.json here: Claude
        Code has not used this folder yet. ClaudeWatch will show nothing until it does.
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-emerald-600">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {inspection.sessionCount > 0
        ? `${inspection.projectCount} project${inspection.projectCount === 1 ? '' : 's'}, ${inspection.sessionCount} session${inspection.sessionCount === 1 ? '' : 's'}.`
        : 'A Claude folder, with no sessions yet.'}
    </p>
  )
}

/**
 * Settings › Claude folder: which folder ClaudeWatch reads, where that choice
 * came from, and a way to pick another. Applying it re-reads everything and
 * reloads the windows.
 */
export default function ClaudeFolderSettings(): React.JSX.Element {
  const paths = useClaudePaths()
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? paths.claudeDir
  const [inspection, setInspection] = useState<ClaudeDirInspection | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)

  // Check what is typed, after a pause.
  useEffect(() => {
    if (draft === null || !draft.trim()) return
    let cancelled = false
    const id = setTimeout(() => {
      setChecking(true)
      void ipc.app
        .inspectClaudeDir(draft)
        .then((r) => {
          if (!cancelled && r.ok) setInspection(r.data)
        })
        .finally(() => !cancelled && setChecking(false))
    }, INSPECT_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [draft])

  const browse = async (): Promise<void> => {
    const result = await ipcCall(() => ipc.app.chooseClaudeDir(), {
      errorMessage: 'Could not open the folder picker',
    })
    if (result.ok && result.data) {
      setDraft(result.data.path)
      setInspection(result.data)
    }
  }

  const apply = async (next: string | null): Promise<void> => {
    setApplying(true)
    const result = await ipcCall(() => ipc.app.setClaudeDir(next), {
      errorMessage: 'Could not use that folder',
    })
    // On success main reloads every window, so this page goes away.
    if (!result.ok) setApplying(false)
  }

  const changed = draft !== null && inspection?.path !== paths.claudeDir
  const canApply = changed && inspection?.isDirectory === true && !checking && !applying

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          ClaudeWatch reads
        </p>
        <p className="mt-1 break-all font-mono text-sm">{paths.claudeDir}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {sourceText(paths.source)}
          {paths.source === 'app-setting' && (
            <>
              {' '}
              Without it: <span className="font-mono">{paths.fallback.claudeDir}</span>.
            </>
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="claude-folder-input" className="text-sm font-medium">
          Use another folder
        </Label>
        <p className="text-xs text-muted-foreground">
          For a second Claude Code setup, or one kept outside your home folder. This changes only
          what ClaudeWatch reads; Claude Code itself follows CLAUDE_CONFIG_DIR.
        </p>
        <div className="flex gap-2">
          <Input
            id="claude-folder-input"
            value={value}
            onChange={(e) => {
              setDraft(e.target.value)
              setInspection(null)
            }}
            spellCheck={false}
            className="font-mono text-xs"
          />
          <Button variant="outline" onClick={() => void browse()} className="shrink-0 gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" /> Browse…
          </Button>
        </div>
        <div className="min-h-5">
          {checking ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
            </p>
          ) : (
            draft !== null && inspection && <InspectionLine inspection={inspection} />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => inspection && void apply(inspection.path)}
            disabled={!canApply}
            className="gap-1.5"
          >
            {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Use this folder
          </Button>
          {paths.source === 'app-setting' && (
            <Button variant="ghost" onClick={() => void apply(null)} disabled={applying}>
              Go back to {paths.fallback.source === 'default' ? 'the default' : 'CLAUDE_CONFIG_DIR'}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Every view is reloaded from the new folder when you switch.
        </p>
      </div>
    </div>
  )
}
