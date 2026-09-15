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
