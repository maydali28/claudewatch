import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ParsedSession } from '@shared/types/session'
import type { ExportFormat } from '@shared/types/session'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ─── exportAsJson ─────────────────────────────────────────────────────────────

export function exportAsJson(session: ParsedSession): string {
  return JSON.stringify(
    {
      id: session.id,
      projectId: session.projectId,
      slug: session.slug,
      metadata: session.metadata,
      records: session.records,
    },
    null,
    2
  )
}

// ─── exportAsCsv ──────────────────────────────────────────────────────────────

export function exportAsCsv(session: ParsedSession): string {
  const rows: string[] = [
    ['timestamp', 'role', 'type', 'text', 'model', 'inputTokens', 'outputTokens', 'cost'].join(','),
  ]

  for (const record of session.records) {
    if (record.type !== 'user' && record.type !== 'assistant') continue

    const role = record.role ?? record.type
    const model = record.model ?? ''
    const inputTokens = record.usage?.inputTokens ?? 0
    const outputTokens = record.usage?.outputTokens ?? 0

    for (const block of record.contentBlocks) {
      if (block.type === 'text') {
        rows.push(
          [
            csvEscape(record.timestamp ?? ''),
            csvEscape(role),
            'text',
            csvEscape(block.text),
            csvEscape(model),
            inputTokens,
            outputTokens,
            '',
          ].join(',')
        )
      } else if (block.type === 'thinking') {
        rows.push(
          [
            csvEscape(record.timestamp ?? ''),
            csvEscape(role),
            'thinking',
            csvEscape(block.thinking),
            csvEscape(model),
            inputTokens,
            outputTokens,
            '',
          ].join(',')
        )
      } else if (block.type === 'tool_use') {
        const inputStr = JSON.stringify(block.input)
        rows.push(
          [
            csvEscape(record.timestamp ?? ''),
            csvEscape(role),
            'tool_use',
            csvEscape(`${block.toolName}: ${inputStr}`),
            csvEscape(model),
            inputTokens,
            outputTokens,
            '',
          ].join(',')
        )
      }
    }
  }

  return rows.join('\n')
}

// ─── exportAsMarkdown ─────────────────────────────────────────────────────────

export function exportAsMarkdown(session: ParsedSession): string {
  const lines: string[] = []

  const meta = session.metadata
  lines.push(`# Session: ${session.slug ?? session.id}`)
  lines.push('')
  lines.push(`- **Project**: \`${session.projectId}\``)
  lines.push(`- **Started**: ${meta.firstTimestamp}`)
  lines.push(`- **Ended**: ${meta.lastTimestamp}`)
  lines.push(`- **Messages**: ${meta.messageCount}`)
  lines.push(`- **Models**: ${meta.models.join(', ')}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const record of session.records) {
    if (record.isCompactionBoundary) {
      lines.push('')
      lines.push('> *--- Context compaction boundary ---*')
      lines.push('')
      continue
    }

    if (record.type === 'user') {
      lines.push('### User')
      lines.push('')
      for (const block of record.contentBlocks) {
        if (block.type === 'text') {
          lines.push(block.text)
          lines.push('')
        }
      }
    } else if (record.type === 'assistant') {
      const modelLabel = record.model ? ` *(${record.model})*` : ''
      lines.push(`### Assistant${modelLabel}`)
      lines.push('')
      for (const block of record.contentBlocks) {
        if (block.type === 'text') {
          lines.push(block.text)
          lines.push('')
        } else if (block.type === 'thinking') {
          lines.push('<details>')
          lines.push('<summary>Thinking</summary>')
          lines.push('')
          lines.push(block.thinking)
          lines.push('')
          lines.push('</details>')
          lines.push('')
        } else if (block.type === 'tool_use') {
          lines.push(`**Tool call**: \`${block.toolName}\``)
          lines.push('```json')
          lines.push(JSON.stringify(block.input, null, 2))
          lines.push('```')
          lines.push('')

          const result = session.toolResultMap[block.id]
          if (result) {
            const errorLabel = result.isError ? ' *(error)*' : ''
            lines.push(`**Tool result**${errorLabel}:`)
            lines.push('```')
            lines.push(result.content.slice(0, 2000))
            if (result.content.length > 2000) lines.push('... (truncated)')
            lines.push('```')
            lines.push('')
          }
        }
      }
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

// ─── writeExport ──────────────────────────────────────────────────────────────

export async function writeExport(
  session: ParsedSession,
  format: ExportFormat,
  outputPath?: string
): Promise<string> {
  let content: string
  let ext: string

  switch (format) {
    case 'json':
      content = exportAsJson(session)
      ext = 'json'
      break
    case 'csv':
      content = exportAsCsv(session)
      ext = 'csv'
      break
    case 'markdown':
      content = exportAsMarkdown(session)
      ext = 'md'
      break
  }

  const filePath =
    outputPath ?? path.join(os.homedir(), 'Downloads', `claudewatch-session-${session.id}.${ext}`)

  await fs.promises.writeFile(filePath, content, 'utf-8')
  return filePath
}
