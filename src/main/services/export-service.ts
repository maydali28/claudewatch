import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ParsedSession, SessionDiagnostics } from '@shared/types/session'
import type { ExportFormat } from '@shared/types/session'
import { compareTimestampsAscending } from '@shared/utils/date-ranges'

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
  const headRows: string[] = []
  const note = diagnosticsNote(session.diagnostics)
  // A leading `#` comment row, not a data column: adding diagnostics as real
  // columns would repeat the same session-wide note on every record row, and
  // most spreadsheet tools already skip `#`-prefixed lines or show them inert.
  // The `#` itself must sit outside any quoting or a tool checking for a
  // literal leading `#` won't see one — only the note's body (which always
  // contains commas) goes through `csvEscape`, not the marker.
  if (note) headRows.push(`#${csvEscape(note)}`)
  headRows.push(
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

  // Body rows are collected with the timestamp they should sort by rather
  // than pushed straight into the final line list — see the sort below the
  // two loops for why: a synthetic usage-only row (built after the main
  // per-record loop has already run) still needs to land at its response's
  // chronological position, not at the end of the file.
  const bodyRows: { timestamp: string; line: string }[] = []

  // A row here is one TRANSCRIPT BLOCK (thinking segment, text segment, or
  // tool_use call) — rows exist for rendering and search, and one
  // content-rich response legitimately spans several of them. Usage,
  // however, is RESPONSE-level: Claude Code writes every block of one API
  // response as its own record, and for a STREAMED response those records
  // don't even repeat identical usage — an early record carries a
  // provisional snapshot (`output_tokens: 1`, no `stop_reason` yet) and the
  // final one carries the real count. Usage (tokens AND cost) is therefore
  // read once per response from `session.responseUsage` — the ledger's
  // MERGED total for that response (see that field's own doc comment), never
  // a single record's raw `usage` — and written on the first row of the
  // response, tracked below by `record.responseId` (`message.id`, or a
  // `uuid:` fallback — see `assistantResponseId`), left EMPTY on every row
  // after it. `response_id` itself stays populated on every row so a
  // consumer can still recover which rows belong together: sum a token
  // column directly for the response-level total, or group by `response_id`
  // first if a per-response breakdown is needed.
  // Doubles as "this response got at least one CONTENT row
  // (text/thinking/tool_use)": compared against `session.responseUsage`'s
  // keys after the loop so a response with usage but no exportable block
  // still contributes it — see the synthetic-row loop below.
  const seenResponseIds = new Set<string>()
  // First record seen for each response id, kept only to source a synthetic
  // row's timestamp/role/model when that response never emits a content row.
  const firstRecordByResponseId = new Map<
    string,
    { timestamp: string; role: string; model: string }
  >()

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
    if (!firstRecordByResponseId.has(responseId)) {
      firstRecordByResponseId.set(responseId, {
        timestamp: record.timestamp ?? '',
        role,
        model,
      })
    }
    // Resolved (ledger-merged) usage for this response when it is a real API
    // response; a user/system row falls back to its own (always-zero) raw
    // usage, unchanged from before this fix. There is no raw-record fallback
    // for cost — it was never read from records before this field existed —
    // so an unresolved response's cost cell is simply left unpriced (`null`).
    const resolved = session.responseUsage[responseId]
    const totalInputTokens = resolved?.inputTokens ?? record.usage?.inputTokens ?? 0
    const totalOutputTokens = resolved?.outputTokens ?? record.usage?.outputTokens ?? 0
    const totalCost = resolved?.costUsd ?? null

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
      // `totalCost === null` covers both an unpriced response (unrecognised
      // model — see `ResponseEntry.costUsd`) and a non-response row (no
      // `resolved` entry at all): either way the cell stays EMPTY rather than
      // `0`, which would misrepresent "not priced" as "priced at zero" — the
      // same distinction `SessionDayModelUsage.estimatedCost`'s own doc
      // comment protects.
      const cost = isFirstRowOfResponse && totalCost !== null ? totalCost : ''

      bodyRows.push({
        timestamp: record.timestamp ?? '',
        line: [
          csvEscape(record.timestamp ?? ''),
          csvEscape(role),
          blockType,
          csvEscape(text),
          csvEscape(model),
          csvEscape(responseId),
          inputTokens,
          outputTokens,
          cost,
        ].join(','),
      })
    }
  }

  // A response the ledger priced but whose records carried no
  // text/thinking/tool_use block would otherwise vanish from this export
  // with no trace of its usage — an accounting CSV silently losing a
  // response that genuinely cost money. Emitted as a `usage`-typed row with
  // empty text so it reads clearly as a bookkeeping entry, not a transcript
  // line; sourced from the first (only, in practice) record seen for that
  // response id for its timestamp/role/model context.
  for (const [responseId, usage] of Object.entries(session.responseUsage)) {
    if (seenResponseIds.has(responseId)) continue
    const meta = firstRecordByResponseId.get(responseId)
    bodyRows.push({
      timestamp: meta?.timestamp ?? '',
      line: [
        csvEscape(meta?.timestamp ?? ''),
        csvEscape(meta?.role ?? ''),
        'usage',
        '',
        csvEscape(meta?.model ?? ''),
        csvEscape(responseId),
        usage.inputTokens,
        usage.outputTokens,
        usage.costUsd !== null ? usage.costUsd : '',
      ].join(','),
    })
  }

  // Every other row in this export is chronological — a synthetic row built
  // AFTER the main loop above would otherwise land at the end of the file
  // regardless of its response's actual timestamp, breaking that order for
  // anyone reading the CSV as a transcript. Compares parsed instants, not
  // raw text: an offset-carrying timestamp (e.g. `+02:00`) can sort later
  // than a `Z` one as a string while naming an earlier instant.
  // `Array.prototype.sort` is stable (guaranteed since ES2019 in Node), so
  // rows sharing an identical timestamp — every block of one response
  // typically does — keep their original relative order rather than being
  // shuffled by this sort.
  bodyRows.sort((a, b) => compareTimestampsAscending(a.timestamp, b.timestamp))

  return [...headRows, ...bodyRows.map((r) => r.line)].join('\n')
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
