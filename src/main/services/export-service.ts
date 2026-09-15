import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ParsedSession, SessionDiagnostics } from '@shared/types/session'
import type { ExportFormat } from '@shared/types/session'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * A human-readable line describing this export's data-quality gaps and
 * provenance notes, or `undefined` when there is nothing to say. An export is
 * a persisted, shareable artefact with no live parser beside it to warn — a
 * file handed to someone else must carry this sign itself or it is silently
 * indistinguishable from a clean parse.
 *
 * `session-details-panel.tsx` renders the same eight fields, split into the
 * same two classes below (`hasErrorDiagnostics`/`hasProvenanceDiagnostics`).
 * Its `responsesWithoutCompletionSignal` sentence reuses this function's
 * provenance clause verbatim ("...maximum observed across snapshots, not a
 * reported final count, because no completion signal was ever seen") so the
 * export and the in-app panel never describe that count two different ways;
 * its `reducedConfidenceResponses` sentence conveys the same fact (no
 * `message.id`, identity falls back to the record uuid) in its own words.
 *
 * The eight `SessionDiagnostics` fields split into two conditions that must
 * NOT share one lead sentence, or the distinction this task exists to
 * establish collapses right back into "something might be wrong":
 * - Error-class (`malformedLines`, `unreadableChildren`, `negativeCounters`,
 *   `conflictCount`, `incompleteUsageResponses`, `unpricedResponses`): data
 *   really may be missing, unreadable, rejected, or unpriced. Leads with
 *   "This export may be missing data:".
 * - Provenance-class (`responsesWithoutCompletionSignal`,
 *   `reducedConfidenceResponses`): nothing is missing — a response was fully
 *   priced and counted either way. Only its output figure's finality
 *   (`responsesWithoutCompletionSignal`: the retained count is the maximum
 *   OBSERVED across snapshots, never a reported final one) or its identity's
 *   reconcilability (`reducedConfidenceResponses`: no `message.id`,
 *   identified by record uuid instead) is weaker than usual. Claiming "may be
 *   missing data" here would be false, so this gets its own honest clause.
 * When both classes are present, the error-class sentence leads and the
 * provenance clause follows it.
 */
function diagnosticsNote(d: SessionDiagnostics): string | undefined {
  const hasErrorClass =
    d.malformedLines > 0 ||
    d.unreadableChildren > 0 ||
    d.negativeCounters > 0 ||
    d.conflictCount > 0 ||
    d.incompleteUsageResponses > 0 ||
    d.unpricedResponses > 0
  const hasProvenanceClass =
    d.responsesWithoutCompletionSignal > 0 || d.reducedConfidenceResponses > 0

  if (!hasErrorClass && !hasProvenanceClass) return undefined

  const errorClause = hasErrorClass
    ? `This export may be missing data: ${d.malformedLines} malformed line(s), ` +
      `${d.unreadableChildren} unreadable subagent file(s), ${d.negativeCounters} ` +
      `rejected negative counter(s), ${d.conflictCount} usage conflict(s), ` +
      `${d.unpricedResponses} unpriced response(s) (unknown model), ` +
      `${d.incompleteUsageResponses} response(s) with incomplete usage data.`
    : undefined

  const provenanceClause = hasProvenanceClass
    ? `${d.responsesWithoutCompletionSignal} response(s) report an output count that is the ` +
      `maximum observed across snapshots, not a reported final count, because no completion ` +
      `signal was ever seen, and ${d.reducedConfidenceResponses} response(s) have ` +
      `reduced-confidence identity (no message.id; identified by record uuid instead).`
    : undefined

  if (errorClause && provenanceClause) return `${errorClause} ${provenanceClause}`
  return errorClause ?? provenanceClause
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
      // Always present, even all-zero: a JSON export is read by tooling as
      // much as by people, and a machine consumer needs the counts to decide
      // whether to trust the totals, not just a note when something is wrong.
      diagnostics: session.diagnostics,
    },
    null,
    2
  )
}

/**
 * Export a session's transcript to CSV, one row per content block plus a
 * `response_id` column identifying the API response each row belongs to
 * (see the comment above the loop below for why usage is written only once
 * per response rather than on every row).
 *
 * Convention a consumer must know before parsing the string this returns:
 * when `session.diagnostics` reports genuinely missing or reduced-confidence
 * data, the FIRST line is a `#`-prefixed comment row (see `diagnosticsNote`),
 * not the header — the header is then the second line. That is an
 * app-specific convention, not a universal CSV rule, so a consumer must not
 * assume line 1 is always the header. It is kept anyway: silently handing
 * someone incomplete accounting data with no sign of it is the worse
 * failure. Detect it with `firstLine.startsWith('#')` and skip that line
 * before reading the header.
 */
export function exportAsCsv(session: ParsedSession): string {
  const rows: string[] = []
  const note = diagnosticsNote(session.diagnostics)
  // A leading `#` comment row, not a data column: adding diagnostics as real
  // columns would repeat the same session-wide note on every record row, and
  // most spreadsheet tools already skip `#`-prefixed lines or show them inert.
  // The `#` itself must sit outside any quoting or a tool checking for a
  // literal leading `#` won't see one — only the note's body (which always
  // contains commas) goes through `csvEscape`, not the marker.
  if (note) rows.push(`#${csvEscape(note)}`)
  rows.push(
    [
      'timestamp',
      'role',
      'type',
      'text',
      'model',
      'response_id',
      'inputTokens',
      'outputTokens',
      'cost',
    ].join(',')
  )

  // A row here is one TRANSCRIPT BLOCK (thinking segment, text segment, or
  // tool_use call) — rows exist for rendering and search, and one
  // content-rich response legitimately spans several of them. Usage,
  // however, is RESPONSE-level: Claude Code writes every block of one API
  // response as its own record and repeats that response's full
  // `message.usage` on each one verbatim, so stamping every block's row with
  // that same usage would make summing a token column overcount by however
  // many blocks (and block-carrying records) the response happened to have.
  // Usage is therefore written once — on the first row of each response,
  // tracked below by `record.responseId` (`message.id`, or a `uuid:`
  // fallback — see `assistantResponseId`) — and left EMPTY on every row
  // after it. `response_id` itself stays populated on every row so a
  // consumer can still recover which rows belong together: sum a token
  // column directly for the response-level total, or group by `response_id`
  // first if a per-response breakdown is needed.
  const seenResponseIds = new Set<string>()

  for (const record of session.records) {
    if (record.type !== 'user' && record.type !== 'assistant') continue

    const role = record.role ?? record.type
    const model = record.model ?? ''
    // User/system records aren't API responses (`record.responseId` is
    // undefined for them); falling back to the record's own uuid still gives
    // every row a stable, groupable id and — since that uuid is unique per
    // record — never gets treated as a repeat, leaving their behavior
    // unchanged (their usage is already always 0).
    const responseId = record.responseId ?? record.uuid
    const totalInputTokens = record.usage?.inputTokens ?? 0
    const totalOutputTokens = record.usage?.outputTokens ?? 0

    for (const block of record.contentBlocks) {
      let blockType: string
      let text: string
      if (block.type === 'text') {
        blockType = 'text'
        text = block.text
      } else if (block.type === 'thinking') {
        blockType = 'thinking'
        text = block.thinking
      } else if (block.type === 'tool_use') {
        blockType = 'tool_use'
        text = `${block.toolName}: ${JSON.stringify(block.input)}`
      } else {
        // `tool_result` blocks (and any future block type) don't get a row
        // here. Deliberately `continue`d before touching `seenResponseIds`
        // below — marking a response "seen" for a block that emits no row
        // would blank the usage on the response's actual first emitted row.
        continue
      }

      const isFirstRowOfResponse = !seenResponseIds.has(responseId)
      seenResponseIds.add(responseId)
      const inputTokens = isFirstRowOfResponse ? totalInputTokens : ''
      const outputTokens = isFirstRowOfResponse ? totalOutputTokens : ''

      rows.push(
        [
          csvEscape(record.timestamp ?? ''),
          csvEscape(role),
          blockType,
          csvEscape(text),
          csvEscape(model),
          csvEscape(responseId),
          inputTokens,
          outputTokens,
          '',
        ].join(',')
      )
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
  // Surfaced here, not just in `exportAsCsv`'s doc comment, so a reader who
  // only ever opens the Markdown export still meets this CSV-specific
  // convention before they meet a CSV file that uses it: this session's CSV
  // export may begin with a `#`-prefixed diagnostics comment row ahead of
  // its header row. That's an app-specific convention, not a universal CSV
  // rule, so a CSV consumer must not assume line 1 is always the header.
  lines.push(
    '- **CSV export note**: the CSV export of this session may start with a `#`-prefixed diagnostics line before its header row — do not assume line 1 is always the header.'
  )
  lines.push('')
  const note = diagnosticsNote(session.diagnostics)
  if (note) {
    lines.push(`> ⚠️ **${note}**`)
    lines.push('')
  }
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
