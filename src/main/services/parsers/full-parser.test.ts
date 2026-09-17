import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'

// See metadata-parser.test.ts for why this mock exists (vitest's `forks` pool
// makes `@main/lib/logger`'s import-time electron-log init throw). Required
// here too since this file imports metadata-parser.ts.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { parseSessionFull } from './full-parser'
import { parseSessionMetadata } from './metadata-parser'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-parser-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * One API response written as three transcript records — a thinking block, a
 * text block and a tool call — each repeating the same usage. All three must
 * remain visible in the transcript; only the accounting collapses.
 */
function responseAsThreeRecords(id: string): Record<string, unknown>[] {
  const usage = {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 5_000,
    cache_creation_input_tokens: 300,
    cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 0 },
  }
  const base = { type: 'assistant', timestamp: '2026-09-10T10:00:00.000Z' }
  return [
    {
      ...base,
      uuid: `${id}-a`,
      message: {
        id,
        role: 'assistant',
        model: 'claude-opus-5',
        usage,
        content: [{ type: 'thinking', thinking: 'hmm' }],
      },
    },
    {
      ...base,
      uuid: `${id}-b`,
      message: {
        id,
        role: 'assistant',
        model: 'claude-opus-5',
        usage,
        content: [{ type: 'text', text: 'answer' }],
      },
    },
    {
      ...base,
      uuid: `${id}-c`,
      message: {
        id,
        role: 'assistant',
        model: 'claude-opus-5',
        usage,
        content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }],
      },
    },
  ]
}

function write(name: string, records: unknown[]): string {
  const file = path.join(dir, `${name}.jsonl`)
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return file
}

/** Writes a subagent transcript beside a parent session file already created by `write()`. */
function writeSubagent(sessionName: string, agentId: string, records: unknown[]): void {
  const subDir = path.join(dir, sessionName, 'subagents')
  fs.mkdirSync(subDir, { recursive: true })
  fs.writeFileSync(
    path.join(subDir, `agent-${agentId}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  )
}

/** An assistant record whose usage carries input/cache-read but no `output_tokens` at all. */
function assistantMissingOutput(uuid: string, id = 'msg_1'): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    },
  }
}

/** A clean, complete assistant record — has a `message.id` and a `stop_reason`. */
function assistantClean(uuid: string, id: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

/** An assistant record with no `message.id` — identity falls back to the record uuid. */
function assistantNoId(uuid: string): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

/**
 * Two snapshots of the same response whose `input_tokens` disagree (10 then
 * 20) — a genuine `usageConflict`, not the tolerated growing-output case (see
 * `ledger.test.ts`'s "does not treat a growing output count as a conflict").
 */
function assistantConflicting(idPrefix: string, id = 'msg_1'): Record<string, unknown>[] {
  return [
    {
      type: 'assistant',
      uuid: `${idPrefix}-a`,
      timestamp: '2026-09-10T10:00:00.000Z',
      message: {
        id,
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'hi' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      },
    },
    {
      type: 'assistant',
      uuid: `${idPrefix}-b`,
      timestamp: '2026-09-10T10:00:01.000Z',
      message: {
        id,
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'hi again' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 0 },
      },
    },
  ]
}

/**
 * A clean assistant record that ran in fast mode and made web search/fetch
 * requests — Task 17's estimate gaps. Priced at the list rate like any other.
 */
function assistantWithEstimateGaps(
  uuid: string,
  id: string,
  requests: number
): Record<string, unknown> {
  const record = assistantClean(uuid, id)
  const message = record.message as Record<string, unknown>
  message.usage = {
    ...(message.usage as Record<string, unknown>),
    speed: 'fast',
    server_tool_use: { web_search_requests: requests, web_fetch_requests: 0 },
  }
  return record
}

const user = {
  type: 'user',
  uuid: 'u1',
  timestamp: '2026-09-10T09:59:00.000Z',
  message: { role: 'user', content: 'hi' },
}

describe('parseSessionFull — accounting', () => {
  it('counts a response once even though three records carry it', async () => {
    const file = write('dup', [user, ...responseAsThreeRecords('msg_1')])

    const { metadata } = await parseSessionFull(file, 'dup', 'proj', ANTHROPIC_PRICING)

    expect(metadata.totalInputTokens).toBe(100)
    expect(metadata.totalOutputTokens).toBe(20)
    expect(metadata.totalCacheReadTokens).toBe(5_000)
    expect(metadata.totalCacheCreationTokens).toBe(300)
  })

  /**
   * The detail panel and the session list sit beside each other, so they must
   * not disagree. Measured on real sessions before this, the detail view was
   * 2-5x higher than the list.
   */
  it('agrees with the session summary', async () => {
    const file = write('agree', [
      user,
      ...responseAsThreeRecords('msg_1'),
      ...responseAsThreeRecords('msg_2'),
    ])

    const { metadata } = await parseSessionFull(file, 'agree', 'proj', ANTHROPIC_PRICING)
    const summary = await parseSessionMetadata(file, 'agree', 'proj', ANTHROPIC_PRICING)

    expect(metadata.totalInputTokens).toBe(summary.totalInputTokens)
    expect(metadata.totalOutputTokens).toBe(summary.totalOutputTokens)
    expect(metadata.totalCacheReadTokens).toBe(summary.totalCacheReadTokens)
  })

  it('takes the completed output when earlier records were provisional', async () => {
    const streaming = responseAsThreeRecords('msg_1')
    // Streaming writes a placeholder count first, then the real one.
    ;(streaming[0].message as { usage: { output_tokens: number } }).usage = {
      ...(streaming[0].message as { usage: Record<string, number> }).usage,
      output_tokens: 1,
    }

    const file = write('streaming', [user, ...streaming])
    const { metadata } = await parseSessionFull(file, 'streaming', 'proj', ANTHROPIC_PRICING)

    expect(metadata.totalOutputTokens).toBe(20)
  })
})

/**
 * Deduplicating usage must not remove anything the user reads. Every content
 * block stays in the transcript.
 */
describe('parseSessionFull — transcript content is untouched', () => {
  it('keeps every record of a deduplicated response', async () => {
    const file = write('content', [user, ...responseAsThreeRecords('msg_1')])

    const { records } = await parseSessionFull(file, 'content', 'proj', ANTHROPIC_PRICING)

    const assistantRecords = records.filter((r) => r.type === 'assistant')
    expect(assistantRecords).toHaveLength(3)
  })

  it('keeps the thinking, text and tool_use blocks', async () => {
    const file = write('blocks', [user, ...responseAsThreeRecords('msg_1')])

    const { records } = await parseSessionFull(file, 'blocks', 'proj', ANTHROPIC_PRICING)
    const kinds = records.flatMap((r) => r.contentBlocks.map((b) => b.type))

    expect(kinds).toContain('thinking')
    expect(kinds).toContain('text')
    expect(kinds).toContain('tool_use')
  })
})

/**
 * The defect this branch fixes: the detail panel counted one assistant
 * RECORD as one message, so a block-split response (thinking + text +
 * tool_use, all sharing one `message.id`) was counted 2-5x. Measured on real
 * history: 25,909 detail-panel messages vs 12,471 in the sessions sidebar.
 */
describe('parseSessionFull — logical message counts', () => {
  it('counts one user prompt and one two-block assistant response as two messages, not three records', async () => {
    // Only the thinking + text records of the shared fixture — two records,
    // one response — so `records.length` (3, including the user prompt)
    // stays visibly different from `messageCount` (2).
    const twoBlockResponse = responseAsThreeRecords('msg_1').slice(0, 2)
    const file = write('msg-count', [user, ...twoBlockResponse])

    const { metadata, records } = await parseSessionFull(
      file,
      'msg-count',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(metadata.messageCount).toBe(2)
    expect(metadata.assistantMessageCount).toBe(1)
    expect(metadata.userMessageCount).toBe(1)
    // The transcript viewer renders every content record — collapsing the
    // count must not collapse the array it reads from.
    expect(records).toHaveLength(3)
  })
})

/**
 * The invariant that was missing and let the defect ship: the detail panel
 * and the sessions sidebar parse the same file and must agree on how many
 * parent messages it contains. Pinning this here means a future change that
 * breaks one parser without the other fails immediately instead of only
 * showing up as a support report.
 */
describe('parseSessionFull — parity with the sessions sidebar', () => {
  it('reports the same parent message count as parseSessionMetadata for block-split responses', async () => {
    const file = write('parity', [
      user,
      ...responseAsThreeRecords('msg_1'),
      ...responseAsThreeRecords('msg_2'),
    ])

    const full = await parseSessionFull(file, 'parity', 'proj', ANTHROPIC_PRICING)
    const summary = await parseSessionMetadata(file, 'parity', 'proj', ANTHROPIC_PRICING)

    expect(full.metadata.messageCount).toBe(summary.parentMessageCount)
  })
})

/**
 * L15/L16: records Claude Code writes as `type: 'user'` that nobody typed —
 * background task notices, sub-agent hand-backs, injected context — carry
 * their kind to the renderer and stay out of the user message count.
 */
describe('parseSessionFull — user record kinds', () => {
  const at = '2026-09-10T09:59:30.000Z'
  const kinds = [
    {
      type: 'user',
      uuid: 'k-prompt',
      timestamp: at,
      origin: { kind: 'human' },
      message: { role: 'user', content: 'do it' },
    },
    {
      type: 'user',
      uuid: 'k-task',
      timestamp: at,
      origin: { kind: 'task-notification' },
      message: {
        role: 'user',
        content: '<task-notification>\n<summary>Agent "x" finished</summary>\n</task-notification>',
      },
    },
    {
      type: 'user',
      uuid: 'k-peer',
      timestamp: at,
      isMeta: true,
      origin: {
        kind: 'peer',
        from: 'a35e2511de91949d1',
        senderTaskId: 'a35e2511de91949d1',
        handback: true,
      },
      message: {
        role: 'user',
        content:
          'Another Claude session sent a message:\n<agent-message from="a35e2511de91949d1">\nreport\n</agent-message>',
      },
    },
    {
      type: 'user',
      uuid: 'k-meta',
      timestamp: at,
      isMeta: true,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Base directory for this skill: /x' }],
      },
    },
    {
      type: 'user',
      uuid: 'k-cmd',
      timestamp: at,
      message: { role: 'user', content: '<command-name>/model</command-name>' },
    },
    {
      type: 'user',
      uuid: 'k-int',
      timestamp: at,
      message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    },
  ]

  it('counts only the two prompts as user messages, in step with the sessions sidebar', async () => {
    const file = write('kinds-count', [user, ...kinds, ...responseAsThreeRecords('msg_1')])
    const full = await parseSessionFull(file, 'kinds-count', 'proj', ANTHROPIC_PRICING)
    const summary = await parseSessionMetadata(file, 'kinds-count', 'proj', ANTHROPIC_PRICING)

    expect(full.metadata.userMessageCount).toBe(2)
    expect(full.metadata.messageCount).toBe(3)
    expect(full.metadata.messageCount).toBe(summary.parentMessageCount)
    expect(summary.dailyUsage.reduce((s, d) => s + d.messageCount, 0)).toBe(summary.messageCount)
  })
})

/**
 * A response's content blocks land as separate records with separate
 * timestamps. Effort and turn-duration must be judged from the whole
 * response, once — not once per record, which either inflates the vote
 * count or (for duration) fabricates several sub-second "turns" out of one
 * response's own interleaved blocks.
 */
describe('parseSessionFull — effort and turn duration counted once per response', () => {
  /**
   * Two records of one response, 600 thinking chars each. Neither crosses
   * the 1000-char "high effort" threshold alone (`EFFORT_MEDIUM_THINKING_CHARS`
   * in tuning.ts), but their sum, 1200, does. Judging each record on its own
   * yields two "medium" votes for one response; judging the response once
   * yields a single "high" vote.
   */
  function splitThinkingResponse(id: string, timestamps: string[]): Record<string, unknown>[] {
    return timestamps.map((ts, i) => ({
      type: 'assistant',
      uuid: `${id}-${i}`,
      timestamp: ts,
      message: {
        id,
        role: 'assistant',
        model: 'claude-opus-5',
        usage: { input_tokens: 50, output_tokens: 10 },
        content: [{ type: 'thinking', thinking: 'x'.repeat(600) }],
      },
    }))
  }

  it('judges effort from the accumulated thinking chars of the whole response, once', async () => {
    const file = write('effort-split', [
      user,
      ...splitThinkingResponse('msg_1', ['2026-09-10T10:00:01.000Z', '2026-09-10T10:00:02.000Z']),
    ])

    const { metadata } = await parseSessionFull(file, 'effort-split', 'proj', ANTHROPIC_PRICING)

    const totalVotes = Object.values(metadata.effortDistribution).reduce(
      (a: number, b: number) => a + b,
      0
    )
    expect(totalVotes).toBe(1)
    expect(metadata.effortDistribution.high).toBe(1)
    expect(metadata.effortDistribution.medium).toBe(0)
  })

  it("records exactly one turn duration per response, anchored to the response's first block", async () => {
    const file = write('duration-split', [
      user,
      ...splitThinkingResponse('msg_1', ['2026-09-10T10:00:05.000Z', '2026-09-10T10:00:06.000Z']),
    ])

    const { metadata } = await parseSessionFull(file, 'duration-split', 'proj', ANTHROPIC_PRICING)

    expect(metadata.turnDurations).toHaveLength(1)
    expect(metadata.turnDurations[0].prevTimestamp).toBe(user.timestamp)
    expect(metadata.turnDurations[0].assistantTimestamp).toBe('2026-09-10T10:00:05.000Z')
    // 09:59:00.000 -> 10:00:05.000, not the ~1s gap between this response's
    // own two records.
    expect(metadata.turnDurations[0].durationMs).toBe(65_000)
  })

  /**
   * This parser's merge block is the twin of `metadata-parser.ts`'s, and both
   * repair a `timestamp` the response's FIRST record could not supply when a
   * later record of the same response carries a usable one. The repair was
   * added here at the same time as there precisely because divergent twin
   * merge blocks are the condition that produced the split in the first
   * place — but it shipped without a test, which made it the seventh
   * structurally-unfailable check found on this branch.
   *
   * It is not a no-op. `timestamp` feeds `errorDetails` and, through
   * `judgeResponse`, `turnDurations`: without the repair `durationMs` is
   * computed from `'invalid'`, comes out `NaN`, fails the `> 0` gate, and the
   * turn is dropped from this parser's output entirely — a real, measured
   * duration silently lost because one of the response's records was
   * malformed.
   */
  it('repairs a response whose first record has an unusable timestamp from a later one', async () => {
    const file = write('duration-undated-first', [
      user,
      ...splitThinkingResponse('msg_1', ['invalid', '2026-09-10T10:00:05.000Z']),
    ])

    const { metadata } = await parseSessionFull(
      file,
      'duration-undated-first',
      'proj',
      ANTHROPIC_PRICING
    )

    // Without the repair this is an empty array: the turn is lost, not merely
    // mis-dated.
    expect(metadata.turnDurations).toHaveLength(1)
    expect(metadata.turnDurations[0].assistantTimestamp).toBe('2026-09-10T10:00:05.000Z')
    expect(metadata.turnDurations[0].durationMs).toBe(65_000)
  })

  /**
   * One-directional here too, matching `activity-reducer.ts`'s `moveBump` and
   * the ledger's own repair: a usable first timestamp is never overwritten by
   * a malformed later one, or a single garbage record would erase a good
   * attribution and take the turn's duration with it.
   */
  it('keeps a usable first timestamp when a later record of the response is malformed', async () => {
    const file = write('duration-undated-second', [
      user,
      ...splitThinkingResponse('msg_1', ['2026-09-10T10:00:05.000Z', 'invalid']),
    ])

    const { metadata } = await parseSessionFull(
      file,
      'duration-undated-second',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(metadata.turnDurations).toHaveLength(1)
    expect(metadata.turnDurations[0].assistantTimestamp).toBe('2026-09-10T10:00:05.000Z')
    expect(metadata.turnDurations[0].durationMs).toBe(65_000)
  })
})

/**
 * Round 2 follow-up: `assistantResponseId`, `laterTimestamp` and the
 * effort/error/duration judgement itself now live in one shared module
 * (`response-observability.ts`) that both `parseSessionFull` and
 * `parseSessionMetadata` import, instead of two hand-maintained copies. This
 * is the parity test the extraction was supposed to make permanent: if the
 * two parsers' judgement ever drifts apart again, this fails immediately
 * instead of only showing up as a support report, the same way the earlier
 * message-count parity test above does for `messageCount`.
 */
describe('parseSessionFull / parseSessionMetadata — effort and turn-duration parity', () => {
  it('agree on effort distribution and turn-duration count for block-split responses', async () => {
    const file = write('effort-duration-parity', [
      user,
      ...responseAsThreeRecords('msg_1'),
      ...responseAsThreeRecords('msg_2'),
    ])

    const full = await parseSessionFull(file, 'effort-duration-parity', 'proj', ANTHROPIC_PRICING)
    const summary = await parseSessionMetadata(
      file,
      'effort-duration-parity',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(full.metadata.effortDistribution).toEqual(summary.observability.effortDistribution)
    expect(full.metadata.turnDurations).toHaveLength(summary.turnDurations.length)
  })
})

/**
 * `classifyError`'s `stop_reason === 'max_tokens'` branch doesn't look at
 * block content, and `stop_reason` repeats byte-identical on every record of
 * a response the same way `usage` does. Classifying it per record — the bug
 * in both parsers before this module existed — pushed one
 * `maxTokensTruncation` entry per record instead of one per truncated
 * response: a duplicated truncation banner on the session detail panel
 * (`session-details-panel.tsx`) for a single truncated turn.
 */
describe('parseSessionFull / parseSessionMetadata — truncation classified once per response', () => {
  function maxTokensTruncatedResponse(id: string, timestamps: string[]): Record<string, unknown>[] {
    return timestamps.map((ts, i) => ({
      type: 'assistant',
      uuid: `${id}-${i}`,
      timestamp: ts,
      message: {
        id,
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 50, output_tokens: 6000 },
        content: [{ type: 'text', text: `chunk ${i}` }],
      },
    }))
  }

  it('produces exactly one maxTokensTruncation entry per response, not one per record', async () => {
    const file = write('truncated', [
      user,
      ...maxTokensTruncatedResponse('msg_1', [
        '2026-09-10T10:00:01.000Z',
        '2026-09-10T10:00:02.000Z',
        '2026-09-10T10:00:03.000Z',
      ]),
    ])

    const full = await parseSessionFull(file, 'truncated', 'proj', ANTHROPIC_PRICING)
    const summary = await parseSessionMetadata(file, 'truncated', 'proj', ANTHROPIC_PRICING)

    const fullTruncations = full.metadata.errorDetails.filter(
      (e) => e.classification === 'maxTokensTruncation'
    )
    const summaryTruncations = summary.observability.errorClassifications.filter(
      (c) => c === 'maxTokensTruncation'
    )

    expect(fullTruncations).toHaveLength(1)
    expect(summaryTruncations).toHaveLength(1)
  })
})

/** An assistant record whose model is unrecognised — priced as null, tokens still counted. */
function assistantUnpriced(uuid: string, id = 'msg_1'): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id,
      role: 'assistant',
      model: 'totally-unrecognised-model-xyz',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

/** A complete, priceable assistant record that never reports a `stop_reason` — no completion signal. */
function assistantWithoutCompletionSignal(uuid: string, id = 'msg_1'): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-10T10:00:00.000Z',
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    },
  }
}

/**
 * Task 6: `parseSessionFull` builds `usage` from `[...ledger.entries()]`
 * ALONE — unlike `parseSessionMetadata`, it never includes subagent entries
 * in that projection (see `full-parser.ts`'s comment above `diagnostics`).
 * So unlike the metadata parser, reading `usage.combined.*` here is only the
 * PARENT's share; the four new completeness fields must be added to
 * `childDiagnostics`'s own figures explicitly, the same way `malformedLines`
 * and `negativeCounters` already are a few lines above. Skipping that combine
 * step is exactly the trap this task's brief calls out: child-session
 * completeness would silently read as zero while looking measured.
 */
describe('parseSessionFull — completeness contract', () => {
  it('reports the incomplete-usage count when a parent response is missing output', async () => {
    const file = write('full-missing-output', [user, assistantMissingOutput('a')])

    const { diagnostics } = await parseSessionFull(
      file,
      'full-missing-output',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics.incompleteUsageResponses).toBe(1)
  })

  it('distinguishes unpriced, incomplete, no-completion-signal and reduced-confidence responses from each other', async () => {
    const file = write('full-distinguish', [user, assistantUnpriced('a')])

    const { diagnostics } = await parseSessionFull(
      file,
      'full-distinguish',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics).toMatchObject({
      unpricedResponses: 1,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    })
  })

  it('reports a response with no completion signal and one with no message.id separately', async () => {
    const file = write('full-no-completion-signal-and-reduced', [
      user,
      assistantClean('b', 'msg_certified'),
      assistantWithoutCompletionSignal('c', 'msg_no_completion_signal'),
      assistantNoId('d'),
    ])

    const { diagnostics } = await parseSessionFull(
      file,
      'full-no-completion-signal-and-reduced',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics.responsesWithoutCompletionSignal).toBe(1)
    expect(diagnostics.reducedConfidenceResponses).toBe(1)
    expect(diagnostics.incompleteUsageResponses).toBe(0)
    expect(diagnostics.unpricedResponses).toBe(0)
  })

  /**
   * The trap: this session's PARENT transcript has no defect of its own — the
   * only incomplete-usage response is inside a subagent file. Before widening
   * `SubagentDiagnostics` (and combining it in here), `usage.combined.*` in
   * this function reflected the parent alone, so this would have read 0.
   */
  it('combines a subagent’s incomplete usage into the parent+child total, not the parent alone', async () => {
    const file = write('full-with-subagent', [user, assistantClean('a', 'msg_parent')])
    writeSubagent('full-with-subagent', 'abc', [assistantMissingOutput('ca1', 'cmsg_1')])

    const { diagnostics } = await parseSessionFull(
      file,
      'full-with-subagent',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics.incompleteUsageResponses).toBe(1)
  })

  /**
   * Both parent and child contribute their own instance of the same
   * condition — the combined total must ADD them (2), not just reflect
   * whichever side happens to be read.
   */
  it('adds parent and subagent counts together rather than one overwriting the other', async () => {
    const file = write('full-both-sides', [user, assistantMissingOutput('a')])
    writeSubagent('full-both-sides', 'xyz', [assistantMissingOutput('ca1', 'cmsg_1')])

    const { diagnostics } = await parseSessionFull(
      file,
      'full-both-sides',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(diagnostics.incompleteUsageResponses).toBe(2)
  })
})

/**
 * Task 2: `full-parser.ts` built `usage` from parent entries alone and then
 * read `conflictCount` straight off it — unlike the four other
 * completeness fields just above, `conflictCount` had no `childDiagnostics`
 * counterpart to add, because `SubagentDiagnostics` didn't carry one. A
 * subagent-only usage conflict (this session's parent transcript is clean)
 * therefore vanished from `full.diagnostics.conflictCount` while
 * `metadata-parser.ts` — which projects parent and child entries together —
 * correctly reported it. See `subagent-parser.ts`'s `SubagentDiagnostics`.
 */
describe('parseSessionFull — child usage conflicts', () => {
  it('counts a usage conflict inside a subagent transcript, not just the parent', async () => {
    const file = write('full-child-conflict', [user, assistantClean('a', 'msg_parent')])
    writeSubagent('full-child-conflict', 'conflict', assistantConflicting('ca', 'cmsg_1'))

    const full = await parseSessionFull(file, 'full-child-conflict', 'proj', ANTHROPIC_PRICING)
    const meta = await parseSessionMetadata(file, 'full-child-conflict', 'proj', ANTHROPIC_PRICING)

    expect(meta.diagnostics.conflictCount).toBe(1)
    expect(full.diagnostics.conflictCount).toBe(1)
  })
})

/**
 * The parity invariant Task 2's review asked for: every field of
 * `full.diagnostics` must equal `metadata.diagnostics` for the same session.
 * Both are declared as the exact same `SessionDiagnostics` shape (see
 * `session.ts`), so there is no field that should legitimately differ
 * between them — unlike `SessionMetadata.total*`, which is deliberately
 * parent-only scoped in the full parser and is NOT covered by this test.
 *
 * Iterating `Object.keys` (rather than asserting field names by hand) means
 * a diagnostics field added in the future is covered by construction: this
 * test fails the moment the two builds disagree on it, with no test-file
 * edit required. It also compares the key sets themselves, so a field
 * present on one side but not the other is caught too.
 *
 * The fixture includes a subagent-only usage conflict specifically because
 * that is the exact case the original defect (this task) got wrong — a
 * parity check built only from clean fixtures could never have caught it.
 */
describe('parseSessionFull / parseSessionMetadata — diagnostics parity', () => {
  it('agrees with the metadata parser on every diagnostics field, including a child-only usage conflict', async () => {
    const file = write('diagnostics-parity', [
      user,
      assistantClean('a', 'msg_parent'),
      assistantWithEstimateGaps('b', 'msg_parent_fast', 2),
    ])
    writeSubagent('diagnostics-parity', 'conflict', [
      ...assistantConflicting('ca', 'cmsg_1'),
      assistantWithEstimateGaps('cb', 'cmsg_fast', 3),
    ])

    const full = await parseSessionFull(file, 'diagnostics-parity', 'proj', ANTHROPIC_PRICING)
    const meta = await parseSessionMetadata(file, 'diagnostics-parity', 'proj', ANTHROPIC_PRICING)

    const fullDiag = full.diagnostics as unknown as Record<string, number>
    const metaDiag = meta.diagnostics as unknown as Record<string, number>

    expect(Object.keys(fullDiag).sort()).toEqual(Object.keys(metaDiag).sort())
    for (const key of Object.keys(metaDiag)) {
      expect(
        fullDiag[key],
        `diagnostics.${key} should match between full and metadata parsers`
      ).toBe(metaDiag[key])
    }

    // Sanity: this session actually exercises the field the original defect
    // broke. Without this, the loop above could pass vacuously on an
    // all-zero session and never have caught the bug it exists to guard.
    expect(fullDiag.conflictCount).toBe(1)
    // Task 17: parent and child each contribute, so a build that drops the
    // child side (full-parser's parent-only projection) cannot pass.
    expect(fullDiag.pricingModifierResponses).toBe(2)
    expect(fullDiag.serverToolRequests).toBe(5)
    // The per-day rows analytics sums must carry the same totals.
    const daySum = (key: 'pricingModifierResponses' | 'serverToolRequests'): number =>
      meta.dailyUsage.reduce((sum, d) => sum + d[key], 0)
    expect(daySum('pricingModifierResponses')).toBe(2)
    expect(daySum('serverToolRequests')).toBe(5)
  })
})
