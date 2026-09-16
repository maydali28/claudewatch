import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'

// vitest 4's default `forks` pool runs tests as forked child processes, not
// worker_threads, so Node's `isMainThread` is true under vitest.
// `@main/lib/logger` calls electron-log's `initialize()` at import time
// whenever `isMainThread` is true, which needs a real Electron main-process
// context and throws otherwise. metadata-parser.ts logs through it, so
// anything importing metadata-parser.ts must mock the logger first — do not
// delete this as boilerplate; removing it reproduces
// `TypeError: this.initializeFn is not a function` at Logger.initialize.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { parseSessionMetadata } from './metadata-parser'
import { computeAnalytics } from '@main/services/analytics-engine'
import type { Project } from '@shared/types/project'
import { UNDATED_DAY } from '@shared/utils/date-ranges'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-parser-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

interface AssistantOpts {
  uuid: string
  /** Omit entirely (rather than pass `undefined`) to test the no-`message.id` fallback. */
  id?: string
  ts?: string
  model?: string
  input?: number
  output?: number
  cacheRead?: number
  cache5m?: number
  /** Omitted by default, matching every fixture below this comment before the completeness-contract tests were added. */
  stopReason?: string
}

function assistant(o: AssistantOpts): Record<string, unknown> {
  const message: Record<string, unknown> = {
    role: 'assistant',
    model: o.model ?? 'claude-opus-5',
    content: [{ type: 'text', text: 'hello' }],
    usage: {
      input_tokens: o.input ?? 0,
      output_tokens: o.output ?? 0,
      cache_read_input_tokens: o.cacheRead ?? 0,
      cache_creation_input_tokens: o.cache5m ?? 0,
      cache_creation: {
        ephemeral_5m_input_tokens: o.cache5m ?? 0,
        ephemeral_1h_input_tokens: 0,
      },
    },
  }
  if (o.id !== undefined) message.id = o.id
  if (o.stopReason !== undefined) message.stop_reason = o.stopReason
  return {
    type: 'assistant',
    uuid: o.uuid,
    timestamp: o.ts ?? '2026-09-10T10:00:00.000Z',
    message,
  }
}

/** An assistant record whose usage carries input/cache-read but no `output_tokens` at all — the exact repro this task exists for. */
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

function user(uuid: string, ts = '2026-09-10T09:59:00.000Z'): Record<string, unknown> {
  return { type: 'user', uuid, timestamp: ts, message: { role: 'user', content: 'hi' } }
}

/** Write a session transcript, optionally with subagent transcripts beside it. */
function session(
  name: string,
  records: unknown[],
  subagents: Record<string, unknown[]> = {}
): string {
  const file = path.join(dir, `${name}.jsonl`)
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  const subDir = path.join(dir, name, 'subagents')
  for (const [agent, agentRecords] of Object.entries(subagents)) {
    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(
      path.join(subDir, `agent-${agent}.jsonl`),
      agentRecords.map((r) => JSON.stringify(r)).join('\n') + '\n'
    )
  }
  return file
}

describe('parseSessionMetadata — usage comes from the response ledger', () => {
  it('counts a response once even when several records carry it', async () => {
    const file = session('dup', [
      user('u1'),
      assistant({ uuid: 'a', id: 'msg_1', input: 100, output: 20 }),
      assistant({ uuid: 'b', id: 'msg_1', input: 100, output: 20 }),
      assistant({ uuid: 'c', id: 'msg_1', input: 100, output: 20 }),
    ])

    const summary = await parseSessionMetadata(file, 'dup', 'proj', ANTHROPIC_PRICING)

    expect(summary.totalInputTokens).toBe(100)
    expect(summary.totalOutputTokens).toBe(20)
  })

  it('still counts distinct responses separately', async () => {
    const file = session('distinct', [
      user('u1'),
      assistant({ uuid: 'a', id: 'msg_1', input: 100, output: 20 }),
      assistant({ uuid: 'b', id: 'msg_2', input: 5, output: 3 }),
    ])

    const summary = await parseSessionMetadata(file, 'distinct', 'proj', ANTHROPIC_PRICING)

    expect(summary.totalInputTokens).toBe(105)
    expect(summary.totalOutputTokens).toBe(23)
  })
})

/**
 * Before this fix, a line that failed `JSON.parse` was dropped by a bare
 * `catch { continue }` with nothing counted — the parse succeeded, quietly,
 * on less data than the file actually contained.
 */
describe('parseSessionMetadata — diagnostics', () => {
  it('reports malformed transcript lines instead of skipping them silently', async () => {
    const file = path.join(dir, 'malformed.jsonl')
    fs.writeFileSync(
      file,
      ['{"type":"user"', JSON.stringify(assistant({ uuid: 'a', id: 'msg_1', input: 5 }))].join('\n')
    )

    const summary = await parseSessionMetadata(file, 'malformed', 'proj', ANTHROPIC_PRICING)

    expect(summary.diagnostics.malformedLines).toBe(1)
    // The one well-formed line after it is still parsed — a bad line does not
    // sink the rest of the file.
    expect(summary.totalInputTokens).toBe(5)
  })

  it('reports zero diagnostics for a clean transcript', async () => {
    // `stopReason` is set explicitly so this fixture is clean across all
    // eight diagnostics, not just the original four — without it, every
    // fixture in this file (none of which sets `stop_reason`) would count as
    // `responsesWithoutCompletionSignal`, which is accurate but not the point
    // of this particular test.
    const file = session('clean', [
      user('u1'),
      assistant({ uuid: 'a', id: 'msg_1', input: 5, stopReason: 'end_turn' }),
    ])

    const summary = await parseSessionMetadata(file, 'clean', 'proj', ANTHROPIC_PRICING)

    expect(summary.diagnostics).toEqual({
      malformedLines: 0,
      unreadableChildren: 0,
      negativeCounters: 0,
      conflictCount: 0,
      unpricedResponses: 0,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    })
  })
})

/**
 * Task 6: the ledger already DETECTED incomplete, no-completion-signal and reduced-
 * confidence usage (see `UsageTotals` in `projection.ts`), but none of it
 * went further than a `log.warn` — a session whose only defect was a missing
 * `output_tokens` field exported with every diagnostic count at zero. These
 * four fields are distinct conditions, not interchangeable, so each test
 * below isolates exactly one of them and asserts the other three stay put.
 */
describe('parseSessionMetadata — completeness contract', () => {
  it('reports the incomplete-usage count when a response is missing output', async () => {
    const file = session('missing-output', [user('u1'), assistantMissingOutput('a')])

    const summary = await parseSessionMetadata(file, 'missing-output', 'proj', ANTHROPIC_PRICING)

    expect(summary.diagnostics.incompleteUsageResponses).toBe(1)
  })

  it('distinguishes unpriced from partially observed from no-completion-signal from reduced-confidence', async () => {
    const unpriced = await parseSessionMetadata(
      session('unpriced', [
        user('u1'),
        assistant({
          uuid: 'a',
          id: 'msg_1',
          model: 'totally-unrecognised-model-xyz',
          input: 10,
          output: 5,
          stopReason: 'end_turn',
        }),
      ]),
      'unpriced',
      'proj',
      ANTHROPIC_PRICING
    )
    expect(unpriced.diagnostics).toMatchObject({
      unpricedResponses: 1,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    })

    const incomplete = await parseSessionMetadata(
      session('incomplete', [user('u1'), assistantMissingOutput('a')]),
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

    const noCompletionSignal = await parseSessionMetadata(
      session('no-completion-signal', [
        user('u1'),
        // No `stopReason` — the default for `assistant()` — so no snapshot of
        // this response ever reports a completion signal.
        assistant({ uuid: 'a', id: 'msg_1', input: 10, output: 5 }),
      ]),
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

    const reducedConfidence = await parseSessionMetadata(
      session('reduced-confidence', [
        user('u1'),
        // `id` omitted — no `message.id`, so identity falls back to the
        // record uuid.
        assistant({ uuid: 'a', input: 10, output: 5, stopReason: 'end_turn' }),
      ]),
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

  /**
   * `metadata-parser.ts` builds `usage` from `[...ledger.entries(), ...childEntries]`
   * in one pass, so `usage.combined.*` is already the parent+child total for
   * these four fields — a subagent's own incomplete usage must show up in the
   * PARENT session's diagnostics, not just in the subagent's own summary.
   */
  it('rolls a subagent’s incomplete usage into the parent session’s diagnostics', async () => {
    const file = session(
      'with-subagent',
      [user('u1'), assistant({ uuid: 'a', id: 'msg_1', input: 5, stopReason: 'end_turn' })],
      { abc: [assistantMissingOutput('ca1', 'cmsg_1')] }
    )

    const summary = await parseSessionMetadata(file, 'with-subagent', 'proj', ANTHROPIC_PRICING)

    expect(summary.diagnostics.incompleteUsageResponses).toBe(1)
  })
})

/**
 * The parent summary rolled up subagent input, output, cost and cache writes
 * but omitted subagent cache reads, so `totalCacheReadTokens` could not
 * reconcile with the model breakdown it was supposedly derived from.
 */
describe('parseSessionMetadata — subagent rollup', () => {
  it('includes subagent cache reads in the session total', async () => {
    const file = session(
      'child-cache',
      [user('u1'), assistant({ uuid: 'a', id: 'msg_1', cacheRead: 100 })],
      { one: [assistant({ uuid: 'c1', id: 'msg_c1', cacheRead: 500 })] }
    )

    const summary = await parseSessionMetadata(file, 'child-cache', 'proj', ANTHROPIC_PRICING)

    expect(summary.totalCacheReadTokens).toBe(600)
  })

  it('reconciles the cache-read total with the model breakdown', async () => {
    const file = session(
      'reconcile',
      [user('u1'), assistant({ uuid: 'a', id: 'msg_1', cacheRead: 100 })],
      {
        one: [assistant({ uuid: 'c1', id: 'msg_c1', model: 'claude-haiku-4-5', cacheRead: 500 })],
      }
    )

    const summary = await parseSessionMetadata(file, 'reconcile', 'proj', ANTHROPIC_PRICING)
    // Per-model usage now lives on the day rows, which is what the model charts
    // read; the session total must still be the sum of its parts.
    const fromModels = summary.dailyUsage
      .flatMap((d) => d.models)
      .reduce((n, m) => n + m.cacheReadTokens, 0)

    expect(fromModels).toBe(summary.totalCacheReadTokens)
  })
})

describe('parseSessionMetadata — model identity', () => {
  it('reports the latest model, not the most-used one', async () => {
    const file = session('switch', [
      user('u1'),
      assistant({ uuid: 'a', id: 'msg_1', ts: '2026-09-10T09:00:00.000Z' }),
      assistant({ uuid: 'b', id: 'msg_2', ts: '2026-09-10T09:30:00.000Z' }),
      assistant({
        uuid: 'c',
        id: 'msg_3',
        ts: '2026-09-10T10:00:00.000Z',
        model: 'claude-sonnet-5',
      }),
    ])

    const summary = await parseSessionMetadata(file, 'switch', 'proj', ANTHROPIC_PRICING)

    expect(summary.latestModel).toBe('claude-sonnet-5')
    expect(summary.dominantModel).toBe('claude-opus-5')
  })
})

/**
 * `estimateCost` returns `null` for a model it cannot price — a real, known
 * rate and a guessed one must never look the same on screen. The day/model
 * projection used to collapse that null to 0 with `?? 0`, which reported an
 * unpriceable model as free rather than unpriced. These two cases must stay
 * distinguishable all the way out to `SessionDayModelUsage.estimatedCost`.
 */
describe('parseSessionMetadata — unpriced models stay unpriced', () => {
  it('leaves an unrecognised model unpriced rather than free', async () => {
    const file = session('unknown-model', [
      assistant({
        uuid: 'a1',
        id: 'm1',
        model: 'claude-opus-4-9',
        input: 1000,
        output: 1000,
      }),
    ])

    const summary = await parseSessionMetadata(file, 'unknown-model', 'proj', ANTHROPIC_PRICING)

    expect(summary.unpricedResponses).toBe(1)
    expect(summary.dailyUsage[0].models[0].estimatedCost).toBeNull()
  })

  it('still reports a real zero for a priced model that genuinely cost nothing', async () => {
    // claude-opus-5 is a recognised model, and the default `assistant()` usage
    // is all zeros, so `estimateCost` computes 0 * rate = 0 for every term —
    // a real, priced answer, not the "cannot price this" null above. An
    // implementation that returns null unconditionally would pass the test
    // above but fail this one.
    const file = session('priced-zero-usage', [
      assistant({ uuid: 'a1', id: 'm1', model: 'claude-opus-5' }),
    ])

    const summary = await parseSessionMetadata(file, 'priced-zero-usage', 'proj', ANTHROPIC_PRICING)

    expect(summary.unpricedResponses).toBe(0)
    expect(summary.dailyUsage[0].models[0].estimatedCost).toBe(0)
  })
})

describe('parseSessionMetadata — non-usage metadata is preserved', () => {
  it('still records message counts and timestamps', async () => {
    const file = session('meta', [
      user('u1', '2026-09-10T09:00:00.000Z'),
      assistant({ uuid: 'a', id: 'msg_1', ts: '2026-09-10T09:01:00.000Z' }),
    ])

    const summary = await parseSessionMetadata(file, 'meta', 'proj', ANTHROPIC_PRICING)

    expect(summary.firstTimestamp).toBe('2026-09-10T09:00:00.000Z')
    expect(summary.lastTimestamp).toBe('2026-09-10T09:01:00.000Z')
    expect(summary.messageCount).toBeGreaterThan(0)
    expect(summary.id).toBe('meta')
    expect(summary.projectId).toBe('proj')
  })

  it('counts a block-split response as one assistant message', async () => {
    const file = path.join(dir, 'split.jsonl')
    const lines = [
      {
        type: 'user',
        uuid: 'u0',
        timestamp: '2026-09-10T10:00:00.000Z',
        message: { content: [{ type: 'text', text: 'go' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-09-10T10:00:01.000Z',
        message: {
          id: 'msg_1',
          model: 'claude-opus-5',
          content: [{ type: 'thinking', thinking: 'hm' }],
          usage: { input_tokens: 1, output_tokens: 10 },
        },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        timestamp: '2026-09-10T10:00:02.000Z',
        message: {
          id: 'msg_1',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 10 },
        },
      },
      {
        type: 'assistant',
        uuid: 'a3',
        timestamp: '2026-09-10T10:00:03.000Z',
        message: {
          id: 'msg_1',
          model: 'claude-opus-5',
          content: [{ type: 'tool_use', name: 'Read' }],
          usage: { input_tokens: 1, output_tokens: 10 },
        },
      },
    ]
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'))

    const summary = await parseSessionMetadata(file, 'split', 'proj', ANTHROPIC_PRICING)

    expect(summary.parentMessageCount).toBe(2) // one user + one assistant response
    expect(summary.messageCount).toBe(2)
    expect(summary.dailyUsage[0].messageCount).toBe(2)
  })

  it('reconciles daily message counts with the session total, including subagents', async () => {
    const parent = path.join(dir, 'recon.jsonl')
    fs.writeFileSync(
      parent,
      [
        {
          type: 'user',
          uuid: 'u0',
          timestamp: '2026-09-10T10:00:00.000Z',
          message: { content: [{ type: 'text', text: 'go' }] },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-09-10T10:00:01.000Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 10 },
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    )

    const subdir = path.join(dir, 'recon', 'subagents')
    fs.mkdirSync(subdir, { recursive: true })
    fs.writeFileSync(
      path.join(subdir, 'agent-x.jsonl'),
      [
        {
          type: 'user',
          uuid: 'cu1',
          timestamp: '2026-09-11T09:00:00.000Z',
          message: { content: [{ type: 'text', text: 'sub' }] },
        },
        {
          type: 'assistant',
          uuid: 'ca1',
          timestamp: '2026-09-11T09:00:01.000Z',
          message: {
            id: 'cm1',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'sub done' }],
            usage: { input_tokens: 1, output_tokens: 5 },
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    )

    const summary = await parseSessionMetadata(parent, 'recon', 'proj', ANTHROPIC_PRICING)

    const dailySum = summary.dailyUsage.reduce((s, d) => s + d.messageCount, 0)
    expect(dailySum).toBe(summary.messageCount)
    expect(summary.messageCount).toBe(4)

    for (const day of summary.dailyUsage) {
      expect(day.messageCount).toBe(day.parentMessageCount + day.childMessageCount)
    }
  })

  /**
   * Task 5: a message with no parsable timestamp still contributed to
   * `summary.messageCount` (the lifetime total) but was silently dropped from
   * `activity.byDay`, since `bump()` returned early for an undefined day —
   * breaking the `sum(dailyUsage.messageCount) === summary.messageCount`
   * invariant the previous test in this file establishes. An explicit
   * undated bucket keeps both true instead.
   */
  it('keeps the daily-sum invariant true when a message has no parsable timestamp', async () => {
    const file = session('undated', [
      user('u1'),
      assistant({ uuid: 'a', id: 'msg_1', input: 100, output: 20 }),
      // No `timestamp` field at all — still real activity, just undated.
      { type: 'user', uuid: 'u2', message: { role: 'user', content: 'no timestamp here' } },
    ])

    const summary = await parseSessionMetadata(file, 'undated', 'proj', ANTHROPIC_PRICING)

    const dailySum = summary.dailyUsage.reduce((s, d) => s + d.messageCount, 0)
    expect(summary.messageCount).toBe(3)
    expect(dailySum).toBe(summary.messageCount)
  })

  /**
   * `flushPendingResponse` used to compute the per-day effort/parallel key
   * with `pending.timestamp ? toDateKey(pending.timestamp) : undefined` — a
   * presence check, not a validity one. A response with a truthy but
   * unparsable timestamp (e.g. a corrupted transcript line) slipped past
   * that check into `toDateKey`, landing under the `NaN-NaN-NaN` key instead
   * of being recognisable as undated.
   */
  it('buckets the effort vote for a malformed response timestamp as undated, not NaN', async () => {
    const file = session('malformed-effort', [
      assistant({ uuid: 'a', id: 'msg_1', ts: 'invalid', output: 20 }),
    ])

    const summary = await parseSessionMetadata(file, 'malformed-effort', 'proj', ANTHROPIC_PRICING)

    expect(summary.dailyUsage.some((d) => d.day.includes('NaN'))).toBe(false)
    const undatedRow = summary.dailyUsage.find((d) => d.day === UNDATED_DAY)
    expect(undatedRow).toBeDefined()
    const effortSum = Object.values(undatedRow!.effortDistribution).reduce((s, n) => s + n, 0)
    expect(effortSum).toBe(1)
  })
})

describe('parseSessionMetadata — observability is grouped by response', () => {
  it('detects parallel tool calls that arrive as separate content records', async () => {
    const file = path.join(dir, 'parallel.jsonl')
    fs.writeFileSync(
      file,
      [
        {
          type: 'user',
          uuid: 'u0',
          timestamp: '2026-09-10T10:00:00.000Z',
          message: { content: [{ type: 'text', text: 'go' }] },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-09-10T10:00:05.000Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'thinking', thinking: 'plan' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'assistant',
          uuid: 'a2',
          timestamp: '2026-09-10T10:00:05.400Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', name: 'Read' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'assistant',
          uuid: 'a3',
          timestamp: '2026-09-10T10:00:05.800Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', name: 'Grep' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    )

    const summary = await parseSessionMetadata(file, 'parallel', 'proj', ANTHROPIC_PRICING)

    expect(summary.observability.parallelToolCallCount).toBe(1)
    expect(summary.observability.maxParallelDegree).toBe(2)
    // One response means one effort vote and one turn duration, not three.
    const efforts = Object.values(summary.observability.effortDistribution).reduce(
      (s, n) => s + n,
      0
    )
    expect(efforts).toBe(1)
    expect(summary.turnDurations).toHaveLength(1)
  })

  /**
   * The lifetime totals above are also attributed to the day the response
   * landed on, so a date-scoped query can read them off `dailyUsage` instead
   * of the session's whole-life observability.
   */
  it('attributes the parallel group and effort vote to the day the response landed on', async () => {
    const file = path.join(dir, 'parallel-day.jsonl')
    fs.writeFileSync(
      file,
      [
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-09-10T10:00:05.000Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'thinking', thinking: 'plan' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'assistant',
          uuid: 'a2',
          timestamp: '2026-09-10T10:00:05.400Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', name: 'Read' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'assistant',
          uuid: 'a3',
          timestamp: '2026-09-10T10:00:05.800Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', name: 'Grep' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    )

    const summary = await parseSessionMetadata(file, 'parallel-day', 'proj', ANTHROPIC_PRICING)

    expect(summary.dailyUsage).toHaveLength(1)
    const [dayRow] = summary.dailyUsage
    expect(dayRow.day).toBe('2026-09-10')
    expect(dayRow.parallelToolGroups).toBe(summary.observability.parallelToolCallCount)
    expect(dayRow.maxParallelDegree).toBe(summary.observability.maxParallelDegree)
    expect(dayRow.effortDistribution).toEqual(summary.observability.effortDistribution)
  })

  /**
   * The single-response fixture above proves the day row and the lifetime
   * total agree when there's only one vote to agree on — that holds by
   * construction and would pass even if per-day accumulation were broken.
   * Four responses of four different effort levels split across two days is
   * the smallest fixture where day-sum-equals-lifetime is not guaranteed by
   * the shape of the input: a bug that dropped a vote, double-counted one, or
   * dumped everything onto a single day would show up here.
   */
  it('reconciles a multi-day, multi-response effort split against the lifetime total', async () => {
    const file = path.join(dir, 'effort-multi-day.jsonl')
    fs.writeFileSync(
      file,
      [
        // Day 1: one low-effort response, one high-effort response.
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-09-10T09:00:00.000Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'done' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'assistant',
          uuid: 'a2',
          timestamp: '2026-09-10T10:00:00.000Z',
          message: {
            id: 'm2',
            model: 'claude-opus-5',
            content: [{ type: 'thinking', thinking: 'x'.repeat(1500) }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        // Day 2: one medium-effort response, one ultrathink response.
        {
          type: 'assistant',
          uuid: 'a3',
          timestamp: '2026-09-11T09:00:00.000Z',
          message: {
            id: 'm3',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'done' }],
            usage: { input_tokens: 1, output_tokens: 800 },
          },
        },
        {
          type: 'assistant',
          uuid: 'a4',
          timestamp: '2026-09-11T10:00:00.000Z',
          message: {
            id: 'm4',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'done' }],
            usage: { input_tokens: 1, output_tokens: 6000 },
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    )

    const summary = await parseSessionMetadata(file, 'effort-multi-day', 'proj', ANTHROPIC_PRICING)

    expect(summary.observability.effortDistribution).toEqual({
      low: 1,
      medium: 1,
      high: 1,
      ultrathink: 1,
    })
    expect(summary.dailyUsage).toHaveLength(2)

    const daySummed = { low: 0, medium: 0, high: 0, ultrathink: 0 }
    for (const d of summary.dailyUsage) {
      daySummed.low += d.effortDistribution.low
      daySummed.medium += d.effortDistribution.medium
      daySummed.high += d.effortDistribution.high
      daySummed.ultrathink += d.effortDistribution.ultrathink
    }
    expect(daySummed).toEqual(summary.observability.effortDistribution)

    // Not just the sum — each day carries a distinct mix, so a bug that piled
    // every vote onto one day (rather than losing or duplicating one) would
    // still pass the sum check above but fails here.
    const [day1, day2] = summary.dailyUsage
    expect(day1.day).toBe('2026-09-10')
    expect(day1.effortDistribution).toEqual({ low: 1, medium: 0, high: 1, ultrathink: 0 })
    expect(day2.day).toBe('2026-09-11')
    expect(day2.effortDistribution).toEqual({ low: 0, medium: 1, high: 0, ultrathink: 1 })
  })

  /**
   * A response is buffered until a differing record ends it. The final
   * response in a file has no such record to trigger that, so the read loop
   * must flush it explicitly — otherwise it is dropped rather than counted.
   */
  it('flushes the final response in the file instead of dropping it', async () => {
    const file = path.join(dir, 'final-response.jsonl')
    fs.writeFileSync(
      file,
      [
        {
          type: 'user',
          uuid: 'u0',
          timestamp: '2026-09-10T10:00:00.000Z',
          message: { content: [{ type: 'text', text: 'go' }] },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-09-10T10:00:05.000Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'text', text: 'done' }],
            usage: { input_tokens: 1, output_tokens: 50 },
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    )

    const summary = await parseSessionMetadata(file, 'final-response', 'proj', ANTHROPIC_PRICING)

    const efforts = Object.values(summary.observability.effortDistribution).reduce(
      (s, n) => s + n,
      0
    )
    expect(efforts).toBe(1)
    expect(summary.turnDurations).toHaveLength(1)
  })

  /**
   * Real history: 12.3% of responses (3,184 of 25,984) have non-contiguous
   * records — Claude Code writes tool_use, then that tool's tool_result (a
   * user record), then the next tool_use, for every multi-tool-call turn.
   * These are exactly the responses whose parallel-tool detection matters
   * most, so a flush trigger that fires on the interleaved user record would
   * split one response into several — the same sub-second-gap and
   * lost-parallel-grouping bugs this task exists to fix.
   */
  it('keeps one response together across tool_result records interleaved between its blocks', async () => {
    const file = path.join(dir, 'interleaved.jsonl')
    fs.writeFileSync(
      file,
      [
        {
          type: 'user',
          uuid: 'u0',
          timestamp: '2026-09-10T10:00:00.000Z',
          message: { content: [{ type: 'text', text: 'go' }] },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-09-10T10:00:05.000Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'thinking', thinking: 'plan' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'assistant',
          uuid: 'a2',
          timestamp: '2026-09-10T10:00:05.200Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', name: 'Read' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'user',
          uuid: 'u1',
          timestamp: '2026-09-10T10:00:05.600Z',
          message: { content: [{ type: 'tool_result', content: 'file contents' }] },
        },
        {
          type: 'assistant',
          uuid: 'a3',
          timestamp: '2026-09-10T10:00:05.900Z',
          message: {
            id: 'm1',
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', name: 'Grep' }],
            usage: { input_tokens: 1, output_tokens: 100 },
          },
        },
        {
          type: 'user',
          uuid: 'u2',
          timestamp: '2026-09-10T10:00:06.300Z',
          message: { content: [{ type: 'tool_result', content: 'grep results' }] },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')
    )

    const summary = await parseSessionMetadata(file, 'interleaved', 'proj', ANTHROPIC_PRICING)

    expect(summary.observability.parallelToolCallCount).toBe(1)
    expect(summary.observability.maxParallelDegree).toBe(2)
    const efforts = Object.values(summary.observability.effortDistribution).reduce(
      (s, n) => s + n,
      0
    )
    expect(efforts).toBe(1)
    expect(summary.turnDurations).toHaveLength(1)
    // Gap from the preceding user turn (10:00:00.000) to the response's own
    // first block (10:00:05.000) — 5000ms, not one of the ~300-700ms gaps
    // between this response's own interleaved blocks.
    expect(summary.turnDurations[0].durationMs).toBe(5000)
  })
})

/**
 * `computeAnalytics`'s fixtures build `maxPreCompactionTokens` by hand
 * through the `day()` helper and never exercise the parser's own rollup at
 * `buildSessionSummary`'s `compactionsByDay` loop, where `entry.maxPreTokens
 * = Math.max(entry.maxPreTokens, event.preTokens ?? 0)` lives. Mutating that
 * to `+=` (restoring the averaging/summing bug an earlier task fixed) passes
 * every other test in this suite — only a parser-level test with two
 * same-day compactions catches it.
 */
describe('parseSessionMetadata — daily compaction rollup takes the max, not the sum', () => {
  it('reports the larger of two same-day pre-compaction contexts, not their sum or mean', async () => {
    const file = session('two-compactions', [
      user('u1', '2026-09-10T09:00:00.000Z'),
      {
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: '2026-09-10T10:00:00.000Z',
        compactMetadata: { preTokens: 10_000 },
      },
      {
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: '2026-09-10T10:01:00.000Z',
        compactMetadata: { preTokens: 90_000 },
      },
      assistant({ uuid: 'a', id: 'msg_1', ts: '2026-09-10T10:02:00.000Z', input: 5 }),
    ])

    const summary = await parseSessionMetadata(file, 'two-compactions', 'proj', ANTHROPIC_PRICING)

    expect(summary.dailyUsage).toHaveLength(1)
    const day = summary.dailyUsage[0]
    expect(day.compactions).toBe(2)
    expect(day.tokensRemovedByCompaction).toBe(100_000)
    // Sum would be 100_000, mean would be 50_000 — the correct answer is the
    // larger single event, 90_000.
    expect(day.maxPreCompactionTokens).toBe(90_000)
  })

  /**
   * `buildSessionSummary`'s `compactionsByDay` loop used to `continue` on a
   * missing timestamp and otherwise hand the raw string straight to
   * `toDateKey` unconditionally — so a truthy-but-malformed timestamp landed
   * under `NaN-NaN-NaN` instead of being recognised as undated.
   */
  it('buckets a compaction event with a malformed timestamp as undated, not NaN', async () => {
    const file = session('malformed-compaction', [
      user('u1'),
      {
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: 'invalid',
        compactMetadata: { preTokens: 5_000 },
      },
      assistant({ uuid: 'a', id: 'msg_1' }),
    ])

    const summary = await parseSessionMetadata(
      file,
      'malformed-compaction',
      'proj',
      ANTHROPIC_PRICING
    )

    expect(summary.dailyUsage.some((d) => d.day.includes('NaN'))).toBe(false)
    const undatedRow = summary.dailyUsage.find((d) => d.day === UNDATED_DAY)
    expect(undatedRow?.compactions).toBe(1)
    expect(undatedRow?.tokensRemovedByCompaction).toBe(5_000)
  })
})

/**
 * Task 5: end-to-end proof that a partial-TTL cache write has ONE dollar
 * figure, not two. Before this fix the ledger priced only the known tier (40
 * of 100 flat write tokens) into `summary.estimatedCost`, while
 * `computeCacheAnalytics`'s tier-cost breakdown already estimated the other
 * 60 at the 5-minute fallback rate — so the session's real spend and the
 * cache tab's own breakdown of that same spend disagreed. Isolated to a pure
 * cache write (zero input/output/read) so the whole cost is directly
 * comparable to the tier breakdown.
 */
describe('parseSessionMetadata + computeAnalytics — partial TTL has one price everywhere', () => {
  it('actual cost equals the tier breakdown’s known-plus-fallback total', async () => {
    const file = session('partial-ttl-e2e', [
      user('u1'),
      {
        type: 'assistant',
        uuid: 'a',
        timestamp: '2026-09-10T10:00:00.000Z',
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'ok' }],
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            // Only 40 of the flat 100 is explained by a TTL tier.
            cache_creation_input_tokens: 100,
            cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 0 },
          },
        },
      },
    ])

    const summary = await parseSessionMetadata(file, 'partial-ttl-e2e', 'proj', ANTHROPIC_PRICING)
    const projects: Project[] = [
      {
        id: 'proj',
        name: 'proj',
        path: '/proj',
        sessions: [],
        sessionCount: 1,
        localSkills: [],
        localClaudeMd: null,
      },
    ]
    const analytics = computeAnalytics([summary], projects, 'all', ANTHROPIC_PRICING)

    const { cost5m, costUnknownTtl } = analytics.cacheAnalytics.tierCostBreakdown
    expect(summary.estimatedCost).toBeCloseTo(cost5m + costUnknownTtl, 10)
    expect(analytics.cacheAnalytics.actualCost).toBeCloseTo(cost5m + costUnknownTtl, 10)
  })
})

/**
 * The undated policy, end to end: one response with no timestamp at all must
 * put its MESSAGES, its TOKENS and its COST in the same bucket.
 *
 * The ledger used to `return null` for an absent timestamp, so the response's
 * spend was deleted while the activity reducer and the metadata parser still
 * counted its message and its effort into `UNDATED_DAY`. `all` then reported
 * a message with no tokens behind it, and `undatedActivity` reported
 * `responses: 0` — positively asserting that nothing was undated — about the
 * very responses that had just been discarded.
 *
 * Asserting `responses` and the token/cost figures together is the point: the
 * disclosure and the totals have to describe the same responses, or the
 * disclosure is a claim the numbers contradict.
 */
describe('parseSessionMetadata + computeAnalytics — an undated response keeps its spend', () => {
  const PROJECTS: Project[] = [
    {
      id: 'proj',
      name: 'proj',
      path: '/proj',
      sessions: [],
      sessionCount: 1,
      localSkills: [],
      localClaudeMd: null,
    },
  ]

  /** One dated response (10/5) and one with no `timestamp` key at all (10/5). */
  function undatedAndDatedSession(): string {
    const dated = assistant({ uuid: 'a1', id: 'msg_1', input: 10, output: 5 })
    const undated = assistant({ uuid: 'a2', id: 'msg_2', input: 10, output: 5 })
    delete undated.timestamp
    return session('undated-spend-e2e', [user('u1'), dated, undated])
  }

  it('counts an undated response’s tokens and cost, not just its message', async () => {
    const summary = await parseSessionMetadata(
      undatedAndDatedSession(),
      'undated-spend-e2e',
      'proj',
      ANTHROPIC_PRICING
    )

    const undatedRow = summary.dailyUsage.find((d) => d.day === UNDATED_DAY)
    expect(undatedRow).toBeDefined()
    // The response was bucketed, not dropped — and it brought its spend.
    expect(undatedRow!.responseCount).toBe(1)
    expect(undatedRow!.inputTokens).toBe(10)
    expect(undatedRow!.outputTokens).toBe(5)
    expect(undatedRow!.estimatedCost).toBeGreaterThan(0)
  })

  it('reports the same undated responses in the totals and in the disclosure', async () => {
    const summary = await parseSessionMetadata(
      undatedAndDatedSession(),
      'undated-spend-e2e',
      'proj',
      ANTHROPIC_PRICING
    )

    const all = computeAnalytics([summary], PROJECTS, 'all', ANTHROPIC_PRICING)
    const thirty = computeAnalytics([summary], PROJECTS, '30d', ANTHROPIC_PRICING)

    // Both responses' tokens under `all`; only the dated one under `30d`. The
    // difference is exactly the undated response, so `all` can no longer show
    // a message whose spend has vanished.
    expect(all.totalTokens).toBe(30)
    expect(thirty.totalTokens).toBe(15)
    expect(all.totalCost).toBeCloseTo(thirty.totalCost * 2, 10)

    // The disclosure names the responses the totals just counted, instead of
    // asserting zero while their messages are reported.
    expect(all.undatedActivity.responses).toBe(1)
    expect(all.undatedActivity.messages).toBeGreaterThan(0)
    expect(thirty.undatedActivity.responses).toBe(1)
    expect(thirty.undatedActivity.includedInTotals).toBe(false)
  })
})

/**
 * The undated REPAIR, end to end: a response whose FIRST record has an
 * unusable timestamp and whose LATER record carries a real one must land
 * entirely on the real calendar day — messages, tokens, cost, effort and
 * parallel-tool group alike.
 *
 * The activity reducer already repaired this (`moveBump`), so it moved the
 * response's MESSAGES onto the day while the ledger left its TOKENS and COST
 * behind in `(undated)` and `flushPendingResponse` left its EFFORT there too:
 * first-seen won in both. The visible result was a calendar day reporting two
 * messages and $0.00 of spend — bucketing was unified, repair was not, and
 * one response ended up accounted in two places.
 *
 * Asserting the absence of an `(undated)` row is the load-bearing half: a
 * repair that moves only some of the response would leave one behind.
 */
describe('parseSessionMetadata + computeAnalytics — a repaired response lands in one bucket', () => {
  const PROJECTS: Project[] = [
    {
      id: 'proj',
      name: 'proj',
      path: '/proj',
      sessions: [],
      sessionCount: 1,
      localSkills: [],
      localClaudeMd: null,
    },
  ]

  /**
   * One response across two records: the first undated, the second dated.
   * Two tool_use blocks so the parallel-tool group is attributed too, and a
   * `thinking` block so the effort vote is something other than the default.
   */
  function splitResponseSession(): string {
    const first = assistant({ uuid: 'a1', id: 'msg_1', ts: 'invalid', input: 100, output: 20 })
    const second = assistant({
      uuid: 'a2',
      id: 'msg_1',
      ts: '2026-09-10T10:00:00.000Z',
      input: 100,
      output: 20,
    })
    ;(first.message as Record<string, unknown>).content = [
      { type: 'tool_use', name: 'Read', input: {} },
    ]
    ;(second.message as Record<string, unknown>).content = [
      { type: 'tool_use', name: 'Bash', input: {} },
    ]
    return session('repair-split-e2e', [user('u1'), first, second])
  }

  it('puts the whole response — messages, tokens, cost, effort, tools — on one day', async () => {
    const summary = await parseSessionMetadata(
      splitResponseSession(),
      'repair-split-e2e',
      'proj',
      ANTHROPIC_PRICING
    )

    // Nothing left behind: the response was repaired, not partly repaired.
    expect(summary.dailyUsage.find((d) => d.day === UNDATED_DAY)).toBeUndefined()

    const dated = summary.dailyUsage.find((d) => d.day === '2026-09-10')
    expect(dated).toBeDefined()
    expect(dated!.responseCount).toBe(1)
    expect(dated!.inputTokens).toBe(100)
    expect(dated!.outputTokens).toBe(20)
    expect(dated!.estimatedCost).toBeGreaterThan(0)
    expect(dated!.messageCount).toBeGreaterThan(0)
    // Effort and the parallel-tool group follow the same repaired timestamp.
    expect(Object.values(dated!.effortDistribution).reduce((s, n) => s + n, 0)).toBe(1)
    expect(dated!.parallelToolGroups).toBe(1)
  })

  it('shows the repaired response’s spend under a calendar range, not just all-time', async () => {
    const summary = await parseSessionMetadata(
      splitResponseSession(),
      'repair-split-e2e',
      'proj',
      ANTHROPIC_PRICING
    )

    const all = computeAnalytics([summary], PROJECTS, 'all', ANTHROPIC_PRICING)
    const thirty = computeAnalytics([summary], PROJECTS, '30d', ANTHROPIC_PRICING)

    // The split used to show 2 messages and $0.00 here while `all` reported
    // the tokens — the attribution, not the total, was what broke.
    expect(thirty.totalTokens).toBe(120)
    expect(thirty.totalCost).toBeGreaterThan(0)
    expect(thirty.totalTokens).toBe(all.totalTokens)
    expect(thirty.totalCost).toBeCloseTo(all.totalCost, 10)
    expect(all.undatedActivity).toEqual({ messages: 0, responses: 0, includedInTotals: true })
  })
})

describe('parseSessionMetadata — turnOpen reflects whether the last turn is still in progress', () => {
  function toolResultUser(uuid: string, ts: string): Record<string, unknown> {
    return {
      type: 'user',
      uuid,
      timestamp: ts,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
      },
    }
  }

  it('is closed when the transcript ends with an end_turn response', async () => {
    const file = session('turn-closed', [
      user('u1'),
      assistant({ uuid: 'a1', id: 'msg_1', stopReason: 'end_turn' }),
    ])
    const s = await parseSessionMetadata(file, 'turn-closed', 'p', ANTHROPIC_PRICING)
    expect(s.turnOpen).toBe(false)
  })

  it('is open while a tool call is still waiting for its result', async () => {
    const file = session('turn-tool', [
      user('u1'),
      assistant({ uuid: 'a1', id: 'msg_1', stopReason: 'tool_use' }),
    ])
    const s = await parseSessionMetadata(file, 'turn-tool', 'p', ANTHROPIC_PRICING)
    expect(s.turnOpen).toBe(true)
  })

  it('is open while the assistant has not yet answered the latest user record', async () => {
    const prompt = session('turn-prompt', [
      assistant({ uuid: 'a0', id: 'msg_0', stopReason: 'end_turn' }),
      user('u1', '2026-09-10T10:01:00.000Z'),
    ])
    expect(
      (await parseSessionMetadata(prompt, 'turn-prompt', 'p', ANTHROPIC_PRICING)).turnOpen
    ).toBe(true)

    const result = session('turn-result', [
      user('u1'),
      assistant({ uuid: 'a1', id: 'msg_1', stopReason: 'tool_use' }),
      toolResultUser('u2', '2026-09-10T10:01:00.000Z'),
    ])
    expect(
      (await parseSessionMetadata(result, 'turn-result', 'p', ANTHROPIC_PRICING)).turnOpen
    ).toBe(true)
  })

  it('ignores non-message records that trail the final response', async () => {
    const file = session('turn-trailing', [
      user('u1'),
      assistant({ uuid: 'a1', id: 'msg_1', stopReason: 'end_turn' }),
      { type: 'queue-operation', operation: 'dequeue', timestamp: '2026-09-10T10:02:00.000Z' },
      { type: 'attachment', uuid: 'att1', timestamp: '2026-09-10T10:02:01.000Z' },
    ])
    const s = await parseSessionMetadata(file, 'turn-trailing', 'p', ANTHROPIC_PRICING)
    expect(s.turnOpen).toBe(false)
  })

  it('keeps the stop_reason an earlier record of the same response already reported', async () => {
    // Claude Code can write a response as several records; `processAssistantRecord`
    // keeps a stop_reason once seen even when a later record of the same
    // response omits it. The turn state must follow that same merge, or a
    // finished response reads as still streaming for the whole open-turn cap.
    const file = session('turn-merged', [
      user('u1'),
      assistant({ uuid: 'a1', id: 'msg_1', stopReason: 'end_turn' }),
      assistant({ uuid: 'a2', id: 'msg_1' }),
    ])
    const s = await parseSessionMetadata(file, 'turn-merged', 'p', ANTHROPIC_PRICING)
    expect(s.turnOpen).toBe(false)
  })

  it('is closed by an interrupt marker, which never gets a reply', async () => {
    const file = session('turn-interrupt', [
      user('u1'),
      assistant({ uuid: 'a1', id: 'msg_1', stopReason: 'tool_use' }),
      {
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-09-10T10:01:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }],
        },
      },
    ])
    const s = await parseSessionMetadata(file, 'turn-interrupt', 'p', ANTHROPIC_PRICING)
    expect(s.turnOpen).toBe(false)
  })

  it('is not opened by a local slash command or a meta record, which Claude never answers', async () => {
    const closedThenCommand = session('turn-command', [
      user('u1'),
      assistant({ uuid: 'a1', id: 'msg_1', stopReason: 'end_turn' }),
      {
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-09-10T10:01:00.000Z',
        message: { role: 'user', content: '<command-name>/cost</command-name>' },
      },
      {
        type: 'user',
        uuid: 'u3',
        timestamp: '2026-09-10T10:01:01.000Z',
        message: {
          role: 'user',
          content: '<local-command-stdout>Total cost: $1</local-command-stdout>',
        },
      },
      {
        type: 'user',
        uuid: 'u4',
        isMeta: true,
        timestamp: '2026-09-10T10:01:02.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Caveat: injected context' }] },
      },
    ])
    const s = await parseSessionMetadata(closedThenCommand, 'turn-command', 'p', ANTHROPIC_PRICING)
    expect(s.turnOpen).toBe(false)
  })

  it('is closed on an empty transcript', async () => {
    const file = session('turn-empty', [])
    const s = await parseSessionMetadata(file, 'turn-empty', 'p', ANTHROPIC_PRICING)
    expect(s.turnOpen).toBe(false)
  })
})
