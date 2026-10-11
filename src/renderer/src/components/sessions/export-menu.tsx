import React from 'react'
import { Download, FileJson, FileText, Sheet } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'
import { ipc } from '@renderer/lib/ipc-client'
import { ipcCall } from '@renderer/lib/ipc-call'
import { toast } from '@renderer/components/shared/toast-host'
import type { ExportFormat } from '@shared/types'

const FORMATS: Array<{
  format: ExportFormat
  label: string
  hint: string
  icon: React.ElementType
}> = [
  { format: 'markdown', label: 'Markdown', hint: 'Readable transcript', icon: FileText },
  { format: 'json', label: 'JSON', hint: 'Every record, for tools', icon: FileJson },
  { format: 'csv', label: 'CSV', hint: 'One row per block, with usage', icon: Sheet },
]

/** The session header's export button: pick a format, then where to save it. */
export function ExportMenu({
  sessionId,
  projectId,
}: {
  sessionId: string
  projectId: string
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false)

  async function exportAs(format: ExportFormat): Promise<void> {
    setBusy(true)
    const result = await ipcCall(() => ipc.sessions.export({ sessionId, projectId, format }), {
      errorMessage: 'Could not export the session',
    })
    setBusy(false)
    if (result.ok && result.data) toast(`Exported to ${result.data}`, 'success')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Export session"
          aria-label="Export session"
          disabled={busy}
        >
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[200px]">
        <DropdownMenuLabel className="text-[11px]">Export session as</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMATS.map(({ format, label, hint, icon: Icon }) => (
          <DropdownMenuItem
            key={format}
            onClick={() => void exportAs(format)}
            className="gap-2 text-[12px]"
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="flex-1">{label}</span>
            <span className="text-[10px] text-muted-foreground">{hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
