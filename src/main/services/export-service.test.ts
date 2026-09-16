import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'

// `full-parser.ts` (pulled in below for real-parse fixtures) imports
// `@main/lib/logger`, which calls electron-log's `initialize()` at import
// time — that throws outside a real Electron main context under vitest's
// `forks` pool. See metadata-parser.test.ts/full-parser.test.ts for the same
// workaround; vi.mock is hoisted above the static import below.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import type { ParsedSession, SessionDiagnostics } from '@shared/types/session'
import { exportAsCsv, exportAsJson, exportAsMarkdown } from './export-service'
import { parseSessionFull } from './parsers/full-parser'

function diagnostics(over: Partial<SessionDiagnostics> = {}): SessionDiagnostics {
  return {
    malformedLines: 0,
    unreadableChildren: 0,
    negativeCounters: 0,
    conflictCount: 0,
    unpricedResponses: 0,
    incompleteUsageResponses: 0,
    responsesWithoutCompletionSignal: 0,
    reducedConfidenceResponses: 0,
    ...over,
  }
}

function makeSession(over: Partial<ParsedSession> = {}): ParsedSession {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    slug: 'a-session',
    records: [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-09-14T00:00:00.000Z',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'hello' }],
        isCompactionBoundary: false,
      },
    ],
    toolResultMap: {},
    metadata: {
      firstTimestamp: '2026-09-14T00:00:00.000Z',
      lastTimestamp: '2026-09-14T00:01:00.000Z',
      messageCount: 1,
      userMessageCount: 1,
      assistantMessageCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      models: [],
      compactionCount: 0,
      turnDurations: [],
      effortDistribution: { low: 0, medium: 0, high: 0, ultrathink: 0 },
      maxIdleGapSeconds: 0,
      compactionEvents: [],
      parallelToolGroups: [],
      errorDetails: [],
    },
    isSubagent: false,
    subagentTotals: { inputTokens: 0, outputTokens: 0, messageCount: 0, estimatedCost: 0 },
    diagnostics: diagnostics(),
    responseUsage: {},
    ...over,
  }
}

// ─── Real-parse fixtures ────────────────────────────────────────────────────
//
// The tests below that pin the completeness-contract *repro* (as opposed to
// unit-testing `diagnosticsNote`'s wording in isolation) go through an actual
// `parseSessionFull` parse rather than hand-building a `ParsedSession`
// literal — a literal's `diagnostics` field is whatever the test typed in, so
// asserting the export echoes it back proves nothing about whether the
// PARSER would ever produce that value. Only a real parse can fail without
// this task's fix.

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-service-'))
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function writeSession(name: string, records: unknown[]): string {
  const file = path.join(dir, `${name}.jsonl`)
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return file
}

const USER_RECORD = {
  type: 'user',
  uuid: 'u1',
  timestamp: '2026-09-10T09:59:00.000Z',
  message: { role: 'user', content: 'hi' },
}

/** Input and cache-read fields present, `output_tokens` deliberately absent — this task's repro. */
function assistantMissingOutput(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_1',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, cache_read_input_tokens: 5 },
    },
  }
}

/** A complete, priceable response whose model is unrecognised. */
function assistantUnpriced(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_1',
      role: 'assistant',
      model: 'totally-unrecognised-model-xyz',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

/** A complete, priceable response that never reports a `stop_reason`. */
function assistantWithoutCompletionSignal(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_1',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

/** A complete, priceable response with no `message.id` — identity falls back to the record uuid. */
function assistantNoId(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

/**
 * `export-service.ts` used to read only `ParsedSession`'s records and
 * metadata: a session with malformed lines, an unreadable subagent file or a
 * rejected counter exported with no sign anything was dropped. An export is a
 * persisted, shareable artefact with no live parser beside it to warn — so
 * the gap must travel with the file itself.
 */
describe('export diagnostics — a session with malformed lines', () => {
  const withGaps = makeSession({
    diagnostics: diagnostics({ malformedLines: 3, unreadableChildren: 1, negativeCounters: 2 }),
  })
  const clean = makeSession()

  it('carries the diagnostics into the JSON export', () => {
    const parsed = JSON.parse(exportAsJson(withGaps))
    expect(parsed.diagnostics).toEqual(
      diagnostics({ malformedLines: 3, unreadableChildren: 1, negativeCounters: 2 })
    )
  })

  it('includes a diagnostics count even when the session is clean, for machine consumers', () => {
    const parsed = JSON.parse(exportAsJson(clean))
    expect(parsed.diagnostics).toEqual(diagnostics())
  })

  it('carries a visible diagnostics note into the CSV export as a leading # comment row', () => {
    const csv = exportAsCsv(withGaps)
    const firstLine = csv.split('\n')[0]
    // Pins the mechanism, not just the presence of a '#' somewhere: the `#`
    // must be the literal first character, unescaped and unquoted, or a tool
    // that checks for a leading `#` (as the code comment claims one does)
    // won't recognise this as a comment row. `csvEscape` wrapping the whole
    // line in quotes — as it did before this fix — would fail this exact
    // assertion while still passing a mere `.toContain('#')` check.
    expect(firstLine.startsWith('#')).toBe(true)
    expect(firstLine[0]).toBe('#')
    expect(firstLine).toContain('3 malformed line')
    expect(firstLine).toContain('1 unreadable subagent file')
    expect(firstLine).toContain('2 rejected negative counter')
    // The header row (real data) must be unaffected — still the second line.
    expect(csv.split('\n')[1]).toBe(
      'timestamp,role,type,text,model,response_id,inputTokens,outputTokens,cost'
    )
  })

  it('omits the CSV diagnostics row for a clean session, leaving the header first', () => {
    const csv = exportAsCsv(clean)
    expect(csv.split('\n')[0]).toBe(
      'timestamp,role,type,text,model,response_id,inputTokens,outputTokens,cost'
    )
  })

  it('carries a visible diagnostics note into the markdown export', () => {
    const md = exportAsMarkdown(withGaps)
    expect(md).toContain('3 malformed line')
    expect(md).toContain('1 unreadable subagent file')
    expect(md).toContain('2 rejected negative counter')
  })

  it('omits the markdown diagnostics note for a clean session', () => {
    const md = exportAsMarkdown(clean)
    expect(md).not.toContain('malformed line')
  })
})

/**
 * Task 6: the ledger already DETECTED `unpricedResponses`, `incompleteUsageResponses`,
 * `responsesWithoutCompletionSignal` and `reducedConfidenceResponses` — see
 * `UsageTotals` in `projection.ts` — but none of it reached an export before
 * this fix: a session whose only defect was a missing `output_tokens` field
 * exported with all four counts at zero and no warning anywhere. Each test
 * below goes through a REAL `parseSessionFull` parse of a fixture that
 * exhibits exactly one condition — a hand-built `ParsedSession` literal would
 * pass unchanged whether or not the parser actually detects anything, since
 * `exportAsJson` always echoes whatever `diagnostics` object it's handed.
 */
describe('export diagnostics — the completeness contract (unpriced / incomplete / no-completion-signal / reduced-confidence)', () => {
  it('exports the incomplete-usage count when a response is missing output', async () => {
    const file = writeSession('missing-output-json', [USER_RECORD, assistantMissingOutput('a')])
    const session = await parseSessionFull(file, 'missing-output-json', 'proj', ANTHROPIC_PRICING)

    expect(session.diagnostics.incompleteUsageResponses).toBe(1)
    expect(JSON.parse(exportAsJson(session)).diagnostics.incompleteUsageResponses).toBe(1)
  })

  it('warns in the markdown export when usage is incomplete', async () => {
    const file = writeSession('missing-output-md', [USER_RECORD, assistantMissingOutput('a')])
    const session = await parseSessionFull(file, 'missing-output-md', 'proj', ANTHROPIC_PRICING)

    expect(exportAsMarkdown(session)).toMatch(/incomplete|missing data/i)
  })

  it('warns in the CSV export when usage is incomplete, as a leading # comment row', async () => {
    const file = writeSession('missing-output-csv', [USER_RECORD, assistantMissingOutput('a')])
    const session = await parseSessionFull(file, 'missing-output-csv', 'proj', ANTHROPIC_PRICING)

    expect(exportAsCsv(session).split('\n')[0]).toMatch(/^#/)
  })

  it('distinguishes unpriced from partially observed from no-completion-signal from reduced-confidence via real parses', async () => {
    const unpricedFile = writeSession('unpriced', [USER_RECORD, assistantUnpriced('a')])
    const unpriced = await parseSessionFull(unpricedFile, 'unpriced', 'proj', ANTHROPIC_PRICING)
    expect(unpriced.diagnostics).toMatchObject({
      unpricedResponses: 1,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    })

    const incompleteFile = writeSession('incomplete', [USER_RECORD, assistantMissingOutput('a')])
    const incomplete = await parseSessionFull(
      incompleteFile,
      'incomplete',
      'proj',
      ANTHROPIC_PRICING
    )
    expect(incomplete.diagnostics).toMatchObject({
      unpricedResponses: 0,
      incompleteUsageResponses: 1,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    })

    const noCompletionSignalFile = writeSession('no-completion-signal', [
      USER_RECORD,
      assistantWithoutCompletionSignal('a'),
    ])
    const noCompletionSignal = await parseSessionFull(
      noCompletionSignalFile,
      'no-completion-signal',
      'proj',
      ANTHROPIC_PRICING
    )
    expect(noCompletionSignal.diagnostics).toMatchObject({
      unpricedResponses: 0,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 1,
      reducedConfidenceResponses: 0,
    })

    const reducedFile = writeSession('reduced-confidence', [USER_RECORD, assistantNoId('a')])
    const reducedConfidence = await parseSessionFull(
      reducedFile,
      'reduced-confidence',
      'proj',
      ANTHROPIC_PRICING
    )
    expect(reducedConfidence.diagnostics).toMatchObject({
      unpricedResponses: 0,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 1,
    })
  })

  it('names each of the four new conditions in its own vocabulary, not a shared generic count', () => {
    const unpriced = makeSession({ diagnostics: diagnostics({ unpricedResponses: 2 }) })
    const incomplete = makeSession({ diagnostics: diagnostics({ incompleteUsageResponses: 3 }) })
    const noCompletionSignal = makeSession({
      diagnostics: diagnostics({ responsesWithoutCompletionSignal: 4 }),
    })
    const reducedConfidence = makeSession({
      diagnostics: diagnostics({ reducedConfidenceResponses: 5 }),
    })

    expect(exportAsMarkdown(unpriced)).toMatch(/2 unpriced response/)
    expect(exportAsMarkdown(incomplete)).toMatch(/3 response.*incomplete usage/)
    expect(exportAsMarkdown(noCompletionSignal)).toMatch(/4 response.*no completion signal/)
    expect(exportAsMarkdown(reducedConfidence)).toMatch(/5 response.*reduced-confidence identity/)
  })

  it('keeps the original four fields’ wording unchanged', () => {
    const withGaps = makeSession({
      diagnostics: diagnostics({ malformedLines: 3, unreadableChildren: 1, negativeCounters: 2 }),
    })

    const md = exportAsMarkdown(withGaps)
    expect(md).toContain('3 malformed line')
    expect(md).toContain('1 unreadable subagent file')
    expect(md).toContain('2 rejected negative counter')
  })

  it('still omits the note when all eight fields are zero', () => {
    const clean = makeSession()

    expect(exportAsMarkdown(clean)).not.toContain('missing data')
    expect(exportAsCsv(clean).split('\n')[0]).not.toMatch(/^#/)
  })
})

// ─── Task 7: CSV rows stop repeating non-additive usage ────────────────────
//
// Claude Code writes one API response as several JSONL records — one per
// content block (thinking, text, each tool_use) — all sharing `message.id`
// and repeating that response's full `message.usage` verbatim. The CSV
// export used to stamp every block's row with that same usage, so summing a
// token column overcounted by however many block rows the response happened
// to produce — the same founding defect (counting records instead of
// responses) the rest of this branch fixed elsewhere, surviving here. Both
// tests below go through a real `parseSessionFull` parse of raw JSONL that
// reproduces the actual shapes Claude Code writes (one record with two text
// blocks; two separate records sharing one `message.id`) rather than a
// hand-built `ParsedSession` literal, which would pass unchanged whether or
// not the export actually deduplicates anything.

/** One record whose `message.content` already carries two text blocks, sharing one usage. */
function assistantTwoBlocksOneRecord(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_two_blocks',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'first block' },
        { type: 'text', text: 'second block' },
      ],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 },
    },
  }
}

/** One of two separate records for the SAME response — the real-world shape of the defect. */
function assistantSplitAcrossRecords(uuid: string, text: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_split',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 },
    },
  }
}

function sumColumn(rows: string[], header: string[], name: string): number {
  const col = header.indexOf(name)
  return rows.reduce((total, row) => {
    const raw = row.split(',')[col]
    return total + (raw === '' ? 0 : Number(raw))
  }, 0)
}

function cell(row: string, header: string[], name: string): string {
  return row.split(',')[header.indexOf(name)]
}

describe('CSV export — response usage is written once per response, not once per block row', () => {
  it('does not repeat response usage across two text blocks carried by one record', async () => {
    const file = writeSession('two-blocks-one-record', [
      USER_RECORD,
      assistantTwoBlocksOneRecord('a'),
    ])
    const session = await parseSessionFull(file, 'two-blocks-one-record', 'proj', ANTHROPIC_PRICING)

    const lines = exportAsCsv(session)
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
    const header = lines[0].split(',')
    const body = lines.slice(1).filter((r) => cell(r, header, 'role') === 'assistant')

    expect(body).toHaveLength(2)
    expect(sumColumn(body, header, 'inputTokens')).toBe(10)
    expect(sumColumn(body, header, 'outputTokens')).toBe(20)
    expect(new Set(body.map((r) => cell(r, header, 'response_id'))).size).toBe(1)
    // The continuation row's token cells are genuinely EMPTY, not zero —
    // zero would be indistinguishable from a response that really consumed
    // no tokens.
    expect(cell(body[1], header, 'inputTokens')).toBe('')
    expect(cell(body[1], header, 'outputTokens')).toBe('')
  })

  it('does not repeat response usage across the same response split into separate JSONL records', async () => {
    const file = writeSession('split-across-records', [
      USER_RECORD,
      assistantSplitAcrossRecords('a1', 'first block'),
      assistantSplitAcrossRecords('a2', 'second block'),
    ])
    const session = await parseSessionFull(file, 'split-across-records', 'proj', ANTHROPIC_PRICING)

    const lines = exportAsCsv(session)
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
    const header = lines[0].split(',')
    const body = lines.slice(1).filter((r) => cell(r, header, 'role') === 'assistant')

    expect(body).toHaveLength(2)
    expect(sumColumn(body, header, 'inputTokens')).toBe(10)
    expect(sumColumn(body, header, 'outputTokens')).toBe(20)
    expect(new Set(body.map((r) => cell(r, header, 'response_id'))).size).toBe(1)
    expect(cell(body[1], header, 'inputTokens')).toBe('')
    expect(cell(body[1], header, 'outputTokens')).toBe('')
  })
})

// ─── Task 1: CSV exports the ledger's RESOLVED usage, not a snapshot ───────
//
// Claude Code writes one API response as several JSONL records. For a
// STREAMED response those records carry DIFFERENT usage: a provisional
// snapshot (`output_tokens: 1`, no `stop_reason` yet) followed by the final
// record with the real count (`output_tokens: 100`). The ledger already
// merges these and settles on 100 (see `ledger.ts`'s "Merge, rather than
// pick" comment) — but `export-service.ts` used to stamp a response's row
// with whichever RECORD happened to be first, which for this shape is the
// placeholder, leaving the row that actually held the truth blank. Measured
// prevalence: 5,780 of 24,661 responses carry this streamed shape.
//
// Every fixture below goes through a real `parseSessionFull` parse — a
// hand-built `ParsedSession` literal would pass unchanged whether or not the
// parser and exporter actually resolve anything, since a literal's
// `responseUsage` is just whatever the test typed in.

/** A response with two snapshots: a provisional one, then the final one with the real count. */
function assistantStreamedSnapshot(
  uuid: string,
  outputTokens: number,
  stopReason: string | null
): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_streamed',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: stopReason,
      content: [{ type: 'text', text: 'partial' }],
      usage: { input_tokens: 10, output_tokens: outputTokens, cache_read_input_tokens: 0 },
    },
  }
}

/** A response whose only record carries no text/thinking/tool_use block — ruling 3's repro. */
function assistantNoExportableBlock(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_no_content',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [],
      usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 0 },
    },
  }
}

/** Writes a subagent transcript beside a parent session file already created by `writeSession()`. */
function writeSubagent(sessionName: string, agentId: string, records: unknown[]): void {
  const subDir = path.join(dir, sessionName, 'subagents')
  fs.mkdirSync(subDir, { recursive: true })
  fs.writeFileSync(
    path.join(subDir, `agent-${agentId}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  )
}

/** A subagent response with a large, distinctive usage — must never leak into the parent's CSV. */
function assistantSubagentUsage(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id: 'msg_subagent',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'subagent work' }],
      usage: { input_tokens: 99999, output_tokens: 88888, cache_read_input_tokens: 0 },
    },
  }
}

function tokenColumnSum(csv: string, columnName: string): number {
  const rows = csv.split('\n').filter((l) => l && !l.startsWith('#'))
  const header = rows[0].split(',')
  return sumColumn(rows.slice(1), header, columnName)
}

describe('CSV export — response usage is the ledger-resolved total, not the first snapshot', () => {
  it('csv output column sums to the resolved response total, not the first snapshot', async () => {
    const file = writeSession('streamed-response', [
      USER_RECORD,
      assistantStreamedSnapshot('a1', 1, null),
      assistantStreamedSnapshot('a2', 100, 'end_turn'),
    ])
    const session = await parseSessionFull(file, 'streamed-response', 'proj', ANTHROPIC_PRICING)

    expect(session.responseUsage['msg_streamed']?.outputTokens).toBe(100)
    expect(tokenColumnSum(exportAsCsv(session), 'outputTokens')).toBe(100)
  })

  it('a response whose records carry no exportable block still contributes its usage', async () => {
    const file = writeSession('no-exportable-block', [USER_RECORD, assistantNoExportableBlock('a')])
    const session = await parseSessionFull(file, 'no-exportable-block', 'proj', ANTHROPIC_PRICING)

    // The parent-only resolved total this session's single response
    // actually settled on — never `session.metadata.totalOutputTokens`,
    // which (see full-parser.ts's own comment above `diagnostics`) happens
    // to equal it here only because this fixture has no subagent; the
    // invariant test below is the one that actually exercises that gap.
    const expectedParentOutput = session.responseUsage['msg_no_content']?.outputTokens
    expect(expectedParentOutput).toBe(50)

    const csv = exportAsCsv(session)
    expect(tokenColumnSum(csv, 'outputTokens')).toBe(expectedParentOutput)

    const rows = csv.split('\n').filter((l) => l && !l.startsWith('#'))
    const header = rows[0].split(',')
    const usageRows = rows.slice(1).filter((r) => cell(r, header, 'type') === 'usage')
    expect(usageRows).toHaveLength(1)
    expect(cell(usageRows[0], header, 'text')).toBe('')
    expect(cell(usageRows[0], header, 'response_id')).toBe('msg_no_content')
  })

  it('still emits usage exactly once per response when two blocks share identical usage', async () => {
    const file = writeSession('two-blocks-regression', [
      USER_RECORD,
      assistantTwoBlocksOneRecord('a'),
    ])
    const session = await parseSessionFull(file, 'two-blocks-regression', 'proj', ANTHROPIC_PRICING)

    expect(tokenColumnSum(exportAsCsv(session), 'inputTokens')).toBe(10)
    expect(tokenColumnSum(exportAsCsv(session), 'outputTokens')).toBe(20)
  })

  /**
   * The single most valuable test here: for a fixture with SEVERAL
   * responses (a streamed one, a two-block one, and a no-exportable-block
   * one) plus a SUBAGENT transcript, the CSV token column sum equals the
   * PARENT-ONLY resolved total — never the parent+subagent combined figure.
   *
   * The subagent is not decoration: `metadata.totalOutputTokens` and
   * `session.responseUsage` both happen to be parent-only already in this
   * parser (see `full-parser.ts`'s comment above its `diagnostics` build),
   * but the CAUTION in this task's brief is to assert against the
   * parent-only resolved total on principle, not against `metadata.total*`
   * — so this fixture gives a subagent a LARGE, distinctive usage of its
   * own. If the CSV (or `responseUsage`) ever leaked subagent tokens into
   * the parent transcript's export, this test's exact-number assertions
   * would fail loudly instead of silently passing by coincidence.
   */
  it('invariant: the CSV token column sum equals the parent-only resolved total across several responses', async () => {
    const file = writeSession('multi-response-invariant', [
      USER_RECORD,
      assistantStreamedSnapshot('a1', 1, null),
      assistantStreamedSnapshot('a2', 100, 'end_turn'),
      assistantTwoBlocksOneRecord('b'),
      assistantNoExportableBlock('c'),
    ])
    writeSubagent('multi-response-invariant', 'xyz', [USER_RECORD, assistantSubagentUsage('sub1')])
    const session = await parseSessionFull(
      file,
      'multi-response-invariant',
      'proj',
      ANTHROPIC_PRICING
    )

    const parentOnlyOutput = Object.values(session.responseUsage).reduce(
      (n, u) => n + u.outputTokens,
      0
    )
    const parentOnlyInput = Object.values(session.responseUsage).reduce(
      (n, u) => n + u.inputTokens,
      0
    )

    // Sanity: the subagent really did contribute usage of its own, and it is
    // large enough that leaking it into the parent sum would be impossible
    // to miss.
    expect(session.subagentTotals.outputTokens).toBeGreaterThan(0)

    expect(parentOnlyOutput).toBe(100 + 20 + 50)
    expect(parentOnlyInput).toBe(10 + 10 + 10)

    const csv = exportAsCsv(session)
    expect(tokenColumnSum(csv, 'outputTokens')).toBe(parentOnlyOutput)
    expect(tokenColumnSum(csv, 'inputTokens')).toBe(parentOnlyInput)
  })
})

// ─── Round 1 review, finding 1: the `cost` column was dead ─────────────────
//
// `ResolvedResponseUsage.costUsd` was computed and documented but nothing
// ever wrote it into the CSV — the trailing column was hard-coded `''` on
// every row — so a priced response and an unpriced one rendered identically
// as an empty cell. Now that the resolved cost exists, it must be written:
// once per response (same row as its tokens), and left EMPTY specifically
// for `costUsd === null` so "unpriced" stays distinguishable from "priced at
// zero" — nothing in this fixture is actually priced at exactly zero, but the
// distinction this preserves is the same one `SessionDayModelUsage.estimatedCost`'s
// own doc comment protects elsewhere in this codebase.

/** A priced, single-block response — model resolves, so `costUsd` is a real number. */
function assistantPriced(uuid: string, id: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'priced' }],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 },
    },
  }
}

/** An unpriced response (unrecognised model) — `costUsd` must resolve to `null`. */
function assistantUnpricedForCost(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:01:00.000Z',
    message: {
      id: 'msg_unpriced_cost',
      role: 'assistant',
      model: 'totally-unrecognised-model-xyz',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'unpriced' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

describe('CSV export — the cost column carries the resolved, ledger-priced cost', () => {
  it('writes the resolved cost once per response: present when priced, empty when unpriced, blank on continuation rows', async () => {
    const file = writeSession('cost-column', [
      USER_RECORD,
      assistantPriced('p1', 'msg_priced'),
      assistantUnpricedForCost('u2'),
      assistantTwoBlocksOneRecord('c1'),
    ])
    const session = await parseSessionFull(file, 'cost-column', 'proj', ANTHROPIC_PRICING)

    const pricedCost = session.responseUsage['msg_priced']?.costUsd
    expect(pricedCost).not.toBeNull()
    expect(pricedCost as number).toBeGreaterThan(0)
    expect(session.responseUsage['msg_unpriced_cost']?.costUsd).toBeNull()
    const twoBlockCost = session.responseUsage['msg_two_blocks']?.costUsd
    expect(twoBlockCost).not.toBeNull()

    const csv = exportAsCsv(session)
    const allRows = csv.split('\n').filter((l) => l && !l.startsWith('#'))
    const header = allRows[0].split(',')
    const body = allRows.slice(1)

    const pricedRow = body.find((r) => cell(r, header, 'response_id') === 'msg_priced')
    expect(pricedRow).toBeDefined()
    expect(cell(pricedRow!, header, 'cost')).toBe(String(pricedCost))

    // The unpriced response's cell is EMPTY, not `0` — `0` would misrepresent
    // "not priced" as "priced at zero".
    const unpricedRow = body.find((r) => cell(r, header, 'response_id') === 'msg_unpriced_cost')
    expect(unpricedRow).toBeDefined()
    expect(cell(unpricedRow!, header, 'cost')).toBe('')

    // Two blocks, one response: cost on the first row, blank on the
    // continuation row — the same once-per-response rule tokens already
    // follow.
    const twoBlockRows = body.filter((r) => cell(r, header, 'response_id') === 'msg_two_blocks')
    expect(twoBlockRows).toHaveLength(2)
    expect(cell(twoBlockRows[0], header, 'cost')).toBe(String(twoBlockCost))
    expect(cell(twoBlockRows[1], header, 'cost')).toBe('')

    // Summing the column (empty cells as 0) equals the parent-only resolved
    // cost — the same invariant shape as the token-sum tests above, now
    // extended to cost.
    const costIdx = header.indexOf('cost')
    const costColumnSum = body.reduce((n, r) => {
      const raw = r.split(',')[costIdx]
      return n + (raw === '' ? 0 : Number(raw))
    }, 0)
    const expectedParentCost = Object.values(session.responseUsage).reduce(
      (n, u) => n + (u.costUsd ?? 0),
      0
    )
    expect(costColumnSum).toBeCloseTo(expectedParentCost, 10)
  })
})

// ─── Round 1 review, finding 2: synthetic rows broke chronological order ───
//
// A blockless response's synthetic `usage` row was appended after the whole
// per-record loop, so it always landed at the end of the file regardless of
// its own timestamp — the rest of the CSV is chronological, so a consumer
// reading it as a transcript saw that row out of place.

/** A single-block response at an explicit timestamp, for pinning row order. */
function assistantTextAt(uuid: string, id: string, timestamp: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp,
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 },
    },
  }
}

/** A blockless response (ruling 3's synthetic-row case) at an explicit timestamp. */
function assistantBlocklessAt(
  uuid: string,
  id: string,
  timestamp: string
): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp,
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [],
      usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 0 },
    },
  }
}

describe('CSV export — synthetic rows keep chronological order', () => {
  it('places a blockless response’s synthetic row at its own chronological position, not at the end of the file', async () => {
    const file = writeSession('chronological-order', [
      USER_RECORD,
      assistantTextAt('early', 'msg_early', '2026-09-10T10:00:00.000Z'),
      assistantBlocklessAt('mid', 'msg_mid_blockless', '2026-09-10T10:05:00.000Z'),
      assistantTextAt('late', 'msg_late', '2026-09-10T10:10:00.000Z'),
    ])
    const session = await parseSessionFull(file, 'chronological-order', 'proj', ANTHROPIC_PRICING)

    const csv = exportAsCsv(session)
    const rows = csv.split('\n').filter((l) => l && !l.startsWith('#'))
    const header = rows[0].split(',')
    const body = rows.slice(1)

    // USER_RECORD (uuid 'u1') produces its own row too, ahead of all three
    // assistant responses — excluded here since this test is only about the
    // relative order of the three assistant responses.
    const assistantResponseOrder = body
      .map((r) => cell(r, header, 'response_id'))
      .filter((id) => id !== 'u1')

    expect(assistantResponseOrder).toEqual(['msg_early', 'msg_mid_blockless', 'msg_late'])
  })

  // Final branch review, finding 2: the sort above used to compare raw
  // timestamp text (`localeCompare`) rather than parsed instants — the exact
  // defect class this branch family spent the rest of its commits
  // eradicating elsewhere. It is invisible with same-offset (`Z`) fixtures
  // like the one above, so this pins it with an offset-bearing timestamp:
  // `10:00+02:00` names an earlier instant (08:00Z) than `09:00Z`, but as
  // raw text `'...09:00...' < '...10:00...'` lexically, so `localeCompare`
  // places the later response first.
  it('orders an offset-bearing timestamp by instant, not by its raw text', async () => {
    const file = writeSession('offset-order', [
      USER_RECORD,
      assistantTextAt('offset', 'msg_offset_earlier', '2026-09-15T10:00:00.000+02:00'),
      assistantTextAt('utc', 'msg_utc_later', '2026-09-15T09:00:00.000Z'),
    ])
    const session = await parseSessionFull(file, 'offset-order', 'proj', ANTHROPIC_PRICING)

    const csv = exportAsCsv(session)
    const rows = csv.split('\n').filter((l) => l && !l.startsWith('#'))
    const header = rows[0].split(',')
    const body = rows.slice(1)

    const assistantResponseOrder = body
      .map((r) => cell(r, header, 'response_id'))
      .filter((id) => id !== 'u1')

    expect(assistantResponseOrder).toEqual(['msg_offset_earlier', 'msg_utc_later'])
  })
})

/**
 * Round 1 review, finding 3: the lead sentence "This export may be missing
 * data:" was firing on `responsesWithoutCompletionSignal` too — a condition
 * this task's own contract defines as provenance, not an error (a response
 * whose output figure is the maximum OBSERVED across snapshots, never a
 * CERTIFIED final one, but whose tokens and cost are fully counted either
 * way). Measured by the reviewer across 120 real sessions: 0 produced a note
 * before, 27 (22.5%) do now, all 27 solely on the provenance count — exactly
 * the distinction this task exists to preserve, re-collapsed by a shared lead
 * sentence. `reducedConfidenceResponses` is provenance for the same reason:
 * the response is fully priced, only its identity is less reconcilable. One
 * test per branch: error-class only, provenance-class only, and both present.
 */
describe('export diagnostics — the lead sentence matches what actually fired', () => {
  it('leads with "may be missing data" when only an error-class condition fired', () => {
    const session = makeSession({ diagnostics: diagnostics({ incompleteUsageResponses: 1 }) })

    const note = exportAsMarkdown(session)
    expect(note).toContain('may be missing data')
    // Nothing here is a provenance-only condition, so its honest wording must
    // not appear as if it had also fired.
    expect(note).not.toContain('maximum observed across snapshots')
  })

  it('does NOT claim data may be missing when only a provenance-class condition fired', () => {
    const noCompletionSignal = makeSession({
      diagnostics: diagnostics({ responsesWithoutCompletionSignal: 3 }),
    })
    const reducedConfidence = makeSession({
      diagnostics: diagnostics({ reducedConfidenceResponses: 2 }),
    })

    const noCompletionSignalNote = exportAsMarkdown(noCompletionSignal)
    expect(noCompletionSignalNote).not.toContain('may be missing data')
    expect(noCompletionSignalNote).toContain('maximum observed across snapshots')
    expect(noCompletionSignalNote).toMatch(/3 response/)

    const reducedNote = exportAsMarkdown(reducedConfidence)
    expect(reducedNote).not.toContain('may be missing data')
    expect(reducedNote).toContain('reduced-confidence identity')
    expect(reducedNote).toMatch(/2 response/)
  })

  it('leads with the error-class sentence and keeps the provenance clause when both fired', () => {
    const session = makeSession({
      diagnostics: diagnostics({ malformedLines: 1, responsesWithoutCompletionSignal: 1 }),
    })

    const note = exportAsMarkdown(session)
    expect(note).toContain('may be missing data')
    expect(note).toContain('1 malformed line')
    expect(note).toContain('maximum observed across snapshots')
    // The error-class sentence leads — its own ending punctuation comes
    // before the provenance clause starts, not interleaved with it.
    expect(note.indexOf('may be missing data')).toBeLessThan(
      note.indexOf('maximum observed across snapshots')
    )
  })
})
