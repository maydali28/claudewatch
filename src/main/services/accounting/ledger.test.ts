import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING, estimateCost } from '@shared/constants/pricing'
import { UNDATED_DAY } from '@shared/utils/date-ranges'
import { ingestFile, type SourceIdentity } from './ledger'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const PARENT: SourceIdentity = {
  kind: 'parent',
  projectId: '-Users-someone-proj',
  sessionId: 'sess-1',
}

/** Write a JSONL fixture and return its path. */
function fixture(name: string, records: unknown[]): string {
  const p = path.join(dir, `${name}.jsonl`)
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return p
}

interface UsageOverrides {
  input?: number
  output?: number
  cacheRead?: number
  cache5m?: number
  cache1h?: number
  flat?: number
}

/** An assistant record as Claude Code writes them. */
function assistant(
  opts: {
    uuid: string
    id?: string | null
    ts?: string
    model?: string | null
    usage?: UsageOverrides
    ttlSplit?: boolean
    extra?: Record<string, unknown>
  } = { uuid: 'u1' }
): Record<string, unknown> {
  const u = opts.usage ?? {}
  const usage: Record<string, unknown> = {
    input_tokens: u.input ?? 0,
    output_tokens: u.output ?? 0,
    cache_read_input_tokens: u.cacheRead ?? 0,
    cache_creation_input_tokens: u.flat ?? (u.cache5m ?? 0) + (u.cache1h ?? 0),
  }
  if (opts.ttlSplit !== false) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: u.cache5m ?? 0,
      ephemeral_1h_input_tokens: u.cache1h ?? 0,
    }
  }
  const message: Record<string, unknown> = { role: 'assistant', usage, content: [] }
  if (opts.id !== null) message.id = opts.id ?? 'msg_default'
  if (opts.model !== null) message.model = opts.model ?? 'claude-opus-5'
  return {
    type: 'assistant',
    uuid: opts.uuid,
    timestamp: opts.ts ?? '2026-09-10T10:00:00.000Z',
    message,
    ...opts.extra,
  }
}

/**
 * An assistant record with a fully custom `message.usage`, for shapes the
 * `assistant()` generator above cannot express — a field entirely absent, a
 * wrong-typed value, or metadata like `thinking_tokens`/`service_tier` it
 * doesn't have knobs for.
 */
function customAssistant(opts: {
  uuid: string
  id?: string
  ts?: string
  model?: string
  usage: Record<string, unknown>
}): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: opts.uuid,
    timestamp: opts.ts ?? '2026-09-10T10:00:00.000Z',
    message: {
      role: 'assistant',
      id: opts.id ?? 'm1',
      model: opts.model ?? 'claude-opus-5',
      content: [],
      usage: opts.usage,
    },
  }
}

function totals(entries: Array<{ inputTokens: number; outputTokens: number }>): {
  input: number
  output: number
} {
  return {
    input: entries.reduce((s, e) => s + e.inputTokens, 0),
    output: entries.reduce((s, e) => s + e.outputTokens, 0),
  }
}

/**
 * The defect this whole redesign exists for: Claude Code writes one transcript
 * record per content block, so a single API response appears as separate
 * thinking / text / tool_use records that each carry the same usage. Summing
 * per record overstated real usage by 3.5x on measured history.
 */
describe('ingestFile — one entry per API response', () => {
  it('counts usage once when several records share a message id', async () => {
    const file = fixture('dup', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { input: 100, output: 20 } }),
      assistant({ uuid: 'b', id: 'msg_1', usage: { input: 100, output: 20 } }),
      assistant({ uuid: 'c', id: 'msg_1', usage: { input: 100, output: 20 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(totals(entries)).toEqual({ input: 100, output: 20 })
  })

  it('records how many transcript records carried the response', async () => {
    const file = fixture('snapshots', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { input: 10 } }),
      assistant({ uuid: 'b', id: 'msg_1', usage: { input: 10 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].snapshotCount).toBe(2)
    expect(entries[0].usageConflict).toBe(false)
  })

  /**
   * Streaming transcripts (observed in every subagent file, 5,780 responses of
   * a 24,649-response history) write provisional records whose `output_tokens`
   * is a placeholder counter — 1, 2, 3 — with a null `stop_reason`, then a
   * final record carrying the real figure. Taking the first snapshot would
   * undercount subagent output by orders of magnitude; only `output_tokens`
   * ever varies, and it only ever grows.
   */
  it('takes the completed output when earlier snapshots were provisional', async () => {
    const file = fixture('streaming', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { input: 2, output: 1 } }),
      assistant({ uuid: 'b', id: 'msg_1', usage: { input: 2, output: 1 } }),
      assistant({ uuid: 'c', id: 'msg_1', usage: { input: 2, output: 362 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].outputTokens).toBe(362)
    expect(entries[0].inputTokens).toBe(2)
    expect(entries[0].snapshotCount).toBe(3)
  })

  it('does not treat a growing output count as a conflict', async () => {
    const file = fixture('growing', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { output: 1 } }),
      assistant({ uuid: 'b', id: 'msg_1', usage: { output: 500 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].usageConflict).toBe(false)
  })

  /**
   * A disagreement in any field other than output is not explained by
   * streaming, so it stays a genuine canary rather than being absorbed.
   */
  it('flags a disagreement in a field that streaming cannot explain', async () => {
    const file = fixture('conflict', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { input: 100, cacheRead: 10 } }),
      assistant({ uuid: 'b', id: 'msg_1', usage: { input: 999, cacheRead: 10 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].usageConflict).toBe(true)
  })

  it('counts distinct responses separately', async () => {
    const file = fixture('distinct', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { input: 100, output: 20 } }),
      assistant({ uuid: 'b', id: 'msg_2', usage: { input: 5, output: 3 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(2)
    expect(totals(entries)).toEqual({ input: 105, output: 23 })
  })

  it('is idempotent — re-ingesting the same file yields identical totals', async () => {
    const file = fixture('idem', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { input: 100, output: 20 } }),
      assistant({ uuid: 'b', id: 'msg_1', usage: { input: 100, output: 20 } }),
    ])

    const first = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const second = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(totals(second.entries)).toEqual(totals(first.entries))
  })
})

/**
 * A response with no `message.id`, or none with a model, must still be counted.
 * The old summary parser accumulated usage inside `if (model)` and dropped it.
 */
describe('ingestFile — usage is never dropped', () => {
  it('keys a response with no message id by its record uuid', async () => {
    const file = fixture('no-id', [
      assistant({ uuid: 'only', id: null, usage: { input: 42, output: 7 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].responseId).toBe('uuid:only')
    expect(totals(entries)).toEqual({ input: 42, output: 7 })
  })

  it('keeps usage that carries no model, as an unpriced unknown', async () => {
    const file = fixture('no-model', [
      assistant({ uuid: 'a', id: 'msg_1', model: null, usage: { input: 10, output: 2 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(totals(entries)).toEqual({ input: 10, output: 2 })
    expect(entries[0].modelFamily).toBe('unknown')
    expect(entries[0].modelRaw).toBeUndefined()
    expect(entries[0].costUsd).toBeNull()
  })

  it('preserves the raw model string alongside the resolved family', async () => {
    const file = fixture('raw-model', [
      assistant({ uuid: 'a', id: 'msg_1', model: 'claude-fable-5-1' }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].modelRaw).toBe('claude-fable-5-1')
    expect(entries[0].modelFamily).toBe('fable-5-1')
  })
})

/**
 * `ledgerResponseId`'s own derivation of the shared identity rule
 * (`id ? id : ...`), pinned the same way `response-observability.ts`'s
 * `assistantResponseId` (`||`) is pinned — see finding 1 in
 * `final-branch-review.md`. Every existing "no message.id" fixture in this
 * file uses `id: null`, which the `assistant()` helper renders as an ABSENT
 * `message.id` key (`undefined`) — a case `??` and `? :` already agree on.
 * None of them used an empty STRING id, which is exactly the case the two
 * operators disagree on: `??` only checks null/undefined, so it would treat
 * `''` as a real, present id and key every empty-id response on the literal
 * string `''`, merging unrelated responses together.
 */
describe('ingestFile — empty-string message.id falls through to the uuid key', () => {
  it("keys a response carrying an EMPTY-STRING message.id by its uuid, not by ''", async () => {
    const file = fixture('empty-id-single', [
      assistant({ uuid: 'the-uuid', id: '', usage: { input: 42, output: 7 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].responseId).toBe('uuid:the-uuid')
    expect(entries[0].responseId).not.toBe('')
  })

  it('keeps two empty-id responses distinct when their uuids differ, instead of merging them', async () => {
    const file = fixture('empty-id-two', [
      assistant({ uuid: 'a', id: '', usage: { input: 10, output: 1 } }),
      assistant({ uuid: 'b', id: '', usage: { input: 20, output: 2 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.responseId).sort()).toEqual(['uuid:a', 'uuid:b'])
    expect(totals(entries)).toEqual({ input: 30, output: 3 })
  })
})

describe('ingestFile — cache write tiers', () => {
  it('keeps the flat total when no TTL split is present', async () => {
    const file = fixture('flat-cache', [
      assistant({ uuid: 'a', id: 'msg_1', ttlSplit: false, usage: { flat: 100 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].cacheWriteFlat).toBe(100)
    expect(entries[0].cacheWrite5m).toBe(0)
    expect(entries[0].cacheWrite1h).toBe(0)
  })

  it('keeps both the split and the flat total when both are present', async () => {
    const file = fixture('split-cache', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { cache5m: 30, cache1h: 70 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].cacheWrite5m).toBe(30)
    expect(entries[0].cacheWrite1h).toBe(70)
    expect(entries[0].cacheWriteFlat).toBe(100)
  })
})

/**
 * A later snapshot of the same response can report larger `output_tokens`
 * while everything else about the response — input, cache read, cache write —
 * stays whatever the first snapshot reported. The merge keeps those retained
 * fields (correctly — see the streaming-completion test above) but must price
 * the response from exactly those fields, not from the second snapshot's own
 * (different) usage.
 */
describe('ingestFile — repricing a merged response', () => {
  it('reprices a merged response from the fields it actually retains', async () => {
    const file = fixture('reprice', [
      assistant({ uuid: 'a', id: 'm1', usage: { input: 10, output: 1 } }),
      assistant({ uuid: 'b', id: 'm1', usage: { input: 100, output: 20 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    expect(entry.inputTokens).toBe(10)
    expect(entry.outputTokens).toBe(20)
    // Cost must match 10 input + 20 output (opus-5: $5 in + $25 out per MTok),
    // not the second snapshot's own cost of 100 input + 20 output.
    //   correct: (10/1e6)*5 + (20/1e6)*25 = 0.00005 + 0.0005 = 0.00055
    //   wrong (old): (100/1e6)*5 + (20/1e6)*25 = 0.0005 + 0.0005 = 0.001
    expect(entry.costUsd).toBeCloseTo(
      estimateCost('opus-5', 10, 20, 0, 0, 0, ANTHROPIC_PRICING)!,
      10
    )
    expect(entry.costUsd).toBeCloseTo(0.00055, 10)
    // Input disagrees between snapshots (10 vs 100), which streaming output
    // growth does not explain, so it stays a flagged conflict.
    expect(entry.usageConflict).toBe(true)
  })
})

/**
 * Two usage shapes the ledger cannot price with confidence. Neither has ever
 * been observed in real history (see `toEntry`'s comment) — these are
 * tripwires, not corrections for data known to exist.
 */
describe('ingestFile — flagging unpriceable usage shapes', () => {
  it('flags a response whose tiers do not add up to its flat counter', async () => {
    const file = fixture('tier-mismatch', [
      assistant({ uuid: 'a', id: 'm1', usage: { flat: 300, cache5m: 100 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].usageIncomplete).toBe(true)
  })

  it('flags a response reporting more than one server-side iteration', async () => {
    const file = fixture('multi-iteration', [
      assistant({
        uuid: 'a',
        id: 'm1',
        extra: {
          message: {
            role: 'assistant',
            id: 'm1',
            model: 'claude-opus-5',
            content: [],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              iterations: [{ input_tokens: 1 }, { input_tokens: 2 }],
            },
          },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].usageIncomplete).toBe(true)
  })

  it('does not flag a response with no tiers, or with exactly one iteration', async () => {
    const file = fixture('complete-usage', [
      assistant({ uuid: 'a', id: 'm1', usage: { flat: 100 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].usageIncomplete).toBe(false)
  })
})

/**
 * `Number.isFinite(-500)` is true, so before this fix a negative raw counter
 * was retained as-is and silently subtracted from a day's total — able to
 * cancel out an unrelated overcount elsewhere rather than showing up as
 * either. A negative counter is not a smaller-than-usual usage figure; it is
 * bad data, and must be treated the same as if it were absent.
 */
describe('ingestFile — negative usage counters', () => {
  it('treats a negative token counter as missing, not as a credit', async () => {
    const file = fixture('negative-input', [
      assistant({ uuid: 'a', id: 'm1', usage: { input: -500, output: 10 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].inputTokens).toBe(0)
    expect(entries[0].usageIncomplete).toBe(true)
  })

  it('rejects a negative counter in any usage field, not only input', async () => {
    const file = fixture('negative-cache-read', [
      assistant({ uuid: 'a', id: 'm1', usage: { input: 10, cacheRead: -1 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].cacheReadTokens).toBe(0)
    expect(entries[0].usageIncomplete).toBe(true)
  })

  /**
   * Claude Code writes one transcript record per content block — thinking,
   * text, each tool_use — all repeating the same `message.usage`. Counting
   * rejected negative counters per record (rather than per response, the
   * unit everything else in this ledger uses) would reintroduce exactly the
   * per-record overcount this whole ledger exists to eliminate, just inside
   * the instrumentation meant to catch defects instead of the totals.
   */
  it('counts a negative-counter response once, not once per content-block record', async () => {
    const file = fixture('negative-multi-record', [
      assistant({ uuid: 'a', id: 'm1', usage: { input: -500, output: 1 } }),
      assistant({ uuid: 'b', id: 'm1', usage: { input: -500, output: 10 } }),
    ])

    const { entries, negativeCounters } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    // Both records collapse to one response, as usual...
    expect(entries).toHaveLength(1)
    // ...and the negative-counter tally follows that same unit: one response
    // flagged, not one count per record it happened to be split across.
    expect(negativeCounters).toBe(1)
  })

  /**
   * The discriminating case: a response that genuinely reports 0 input
   * tokens is complete data, not bad data. If rejection collapsed onto the
   * same code path as "reads as zero" without distinguishing why, a fix for
   * negative counters could start flagging every legitimately zero-usage
   * response too.
   */
  it('does not flag a response that genuinely reports zero usage', async () => {
    const file = fixture('genuine-zero', [
      assistant({ uuid: 'a', id: 'm1', usage: { input: 0, output: 10 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].inputTokens).toBe(0)
    expect(entries[0].usageIncomplete).toBe(false)
  })
})

/**
 * Per Anthropic's compaction docs, a server-side-compaction response's
 * top-level `input`/`output` EXCLUDE the compaction iterations — summing the
 * `iterations` entries gives the full request usage, so this ledger's
 * top-level-only accounting UNDERCOUNTS that documented shape. See the full
 * explanation above `toEntry`'s `iterations` handling in ledger.ts for why
 * that gap is flagged (`usageIncomplete`) rather than fixed by summing: no
 * transcript in measured history has more than one iteration to validate an
 * implementation against, and summing would double-count the common
 * single-iteration shape tested below, where the lone entry already equals
 * the top level.
 */
describe('ingestFile — iterations', () => {
  it('captures iterations without adding them to the response totals', async () => {
    const file = fixture('iterations', [
      assistant({
        uuid: 'a',
        id: 'msg_1',
        usage: { input: 23_000, output: 1_000 },
        extra: {
          message: {
            role: 'assistant',
            id: 'msg_1',
            model: 'claude-opus-5',
            content: [],
            usage: {
              input_tokens: 23_000,
              output_tokens: 1_000,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              iterations: [{ type: 'compaction', input_tokens: 180_000, output_tokens: 3_500 }],
            },
          },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(totals(entries)).toEqual({ input: 23_000, output: 1_000 })
    expect(entries[0].iterationsRaw).toBeDefined()
  })

  /**
   * The documented multi-iteration shape itself: more than one entry in
   * `iterations`. Never observed in measured history (see `toEntry`), but the
   * ledger must still flag it rather than silently pricing from top-level
   * counters the docs say are incomplete for this exact shape.
   */
  it('flags a multi-iteration response as incomplete usage', async () => {
    const file = fixture('multi-iteration-incomplete', [
      customAssistant({
        uuid: 'a',
        id: 'm1',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          iterations: [
            { type: 'compaction', input_tokens: 10, output_tokens: 20 },
            { type: 'compaction', input_tokens: 5, output_tokens: 3 },
          ],
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].usageIncomplete).toBe(true)
  })

  /**
   * The guard against the misreading a prior review warned about: reading
   * "iterations are omitted" as "add all iterations on top of the top-level
   * counters" double-counts the main iteration, which the top-level counters
   * already include for this — the ordinary, measured — shape. A
   * single-iteration array whose one entry matches the top level must be
   * counted once, not twice, and must not be flagged: it is complete data,
   * not the documented gap.
   */
  it('counts a single-iteration array once, not twice', async () => {
    const file = fixture('single-iteration-matches-top-level', [
      customAssistant({
        uuid: 'a',
        id: 'm1',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          iterations: [{ type: 'assistant', input_tokens: 10, output_tokens: 20 }],
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].inputTokens).toBe(10)
    expect(entries[0].outputTokens).toBe(20)
    expect(entries[0].usageIncomplete).toBe(false)
  })
})

describe('ingestFile — timestamps and days', () => {
  it('gives each response its own timestamp rather than the file’s last', async () => {
    const file = fixture('multiday', [
      assistant({ uuid: 'a', id: 'msg_1', ts: '2026-09-08T09:00:00.000Z' }),
      assistant({ uuid: 'b', id: 'msg_2', ts: '2026-09-09T09:00:00.000Z' }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries.map((e) => e.tsUtc)).toEqual([
      '2026-09-08T09:00:00.000Z',
      '2026-09-09T09:00:00.000Z',
    ])
    expect(new Set(entries.map((e) => e.dayLocal)).size).toBe(2)
  })

  /**
   * `toEntry` only rejects a *falsy* timestamp (`if (!timestamp) return null`).
   * A present-but-garbage string like `'invalid'` passes that check and used
   * to reach `toDateKey`, whose `new Date('invalid').getFullYear()` etc. all
   * return `NaN` — producing the day key `NaN-NaN-NaN`, a bucket no range
   * filter or repair path can ever recognise. The record must still be
   * accepted (it has a truthy timestamp), just bucketed under the shared
   * `UNDATED_DAY` sentinel instead.
   */
  it('accepts a response with a truthy but unparsable timestamp and buckets it as undated', async () => {
    const file = fixture('malformed-timestamp', [
      assistant({ uuid: 'a', id: 'msg_1', ts: 'invalid' }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].dayLocal).toBe(UNDATED_DAY)
    expect(entries[0].dayLocal).not.toMatch(/NaN/)
  })

  /**
   * Bucketing an undated response was unified across the ledger, the activity
   * reducer and the metadata parser; REPAIRING one was not. The reducer moves
   * a response out of `(undated)` when a later record of it carries a usable
   * timestamp (`moveBump`); the ledger's snapshot merge refreshed seven other
   * fields but never `dayLocal`, so first-seen won.
   *
   * One response then split its own accounting across two buckets: its
   * messages landed on the real calendar day while its tokens and its cost
   * stayed in `(undated)` — a day showing messages and $0.00 spend under any
   * calendar range. Both halves must move together.
   */
  it('relocates a response out of the undated bucket when a later record is dated', async () => {
    const file = fixture('undated-then-dated', [
      assistant({ uuid: 'a', id: 'msg_1', ts: 'invalid', usage: { input: 100, output: 20 } }),
      assistant({
        uuid: 'b',
        id: 'msg_1',
        ts: '2026-09-10T10:00:00.000Z',
        usage: { input: 100, output: 20 },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].dayLocal).toBe('2026-09-10')
    // The entry's own timestamp moves with its day, so the two still agree.
    expect(entries[0].tsUtc).toBe('2026-09-10T10:00:00.000Z')
    // The repair is attribution only — it must not disturb the merge.
    expect(entries[0].inputTokens).toBe(100)
    expect(entries[0].outputTokens).toBe(20)
    expect(entries[0].usageConflict).toBe(false)
  })

  /**
   * One-directional, exactly like the reducer's `moveBump`: a response only
   * ever leaves the undated bucket. A first record with a real day must not
   * be dragged into `(undated)` by a later malformed one, or a garbage
   * timestamp anywhere in a response would erase a good attribution.
   */
  it('never drags a dated response into the undated bucket', async () => {
    const file = fixture('dated-then-undated', [
      assistant({ uuid: 'a', id: 'msg_1', ts: '2026-09-10T10:00:00.000Z' }),
      assistant({ uuid: 'b', id: 'msg_1', ts: 'invalid' }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].dayLocal).toBe('2026-09-10')
    expect(entries[0].tsUtc).toBe('2026-09-10T10:00:00.000Z')
  })

  /**
   * The repair was unified in LOGIC but not in ADMISSION. `add()` turns away
   * any record with no `message.usage` before it can reach `toEntry` or the
   * merge; the activity reducer and the metadata parser have no such
   * requirement. So a later, correctly-dated record that carried no usage
   * repaired the response's day in those two producers while this ledger
   * left it in `(undated)` — the same split, through a different door: a
   * calendar day showing messages and $0.00 of spend.
   *
   * The usage check governs whether an ENTRY is built, not whether a date
   * correction is heard.
   */
  it('relocates a response from a later dated record that carries no usage', async () => {
    const undatedWithUsage = assistant({
      uuid: 'a',
      id: 'msg_1',
      ts: 'invalid',
      usage: { input: 100, output: 20 },
    })
    // A real record shape: same response, a real timestamp, no usage at all.
    const datedWithoutUsage = {
      type: 'assistant',
      uuid: 'b',
      timestamp: '2026-09-10T10:00:00.000Z',
      message: { role: 'assistant', id: 'msg_1', model: 'claude-opus-5', content: [] },
    }
    const file = fixture('undated-usage-then-dated-no-usage', [undatedWithUsage, datedWithoutUsage])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].dayLocal).toBe('2026-09-10')
    expect(entries[0].tsUtc).toBe('2026-09-10T10:00:00.000Z')
    // The usage-less record must repair the date without being counted as a
    // snapshot or disturbing what the response spent.
    expect(entries[0].snapshotCount).toBe(1)
    expect(entries[0].inputTokens).toBe(100)
    expect(entries[0].outputTokens).toBe(20)
  })

  /**
   * The same gap in the other arrival order, which a merge-path-only repair
   * cannot close: the dated usage-less record comes FIRST, so by the time the
   * undated usage-carrying record creates the entry there is no later record
   * left to repair from. The date has to be remembered for the response, not
   * read off whichever record happens to merge.
   */
  it('relocates a response created after a dated usage-less record was already seen', async () => {
    const datedWithoutUsage = {
      type: 'assistant',
      uuid: 'a',
      timestamp: '2026-09-10T10:00:00.000Z',
      message: { role: 'assistant', id: 'msg_1', model: 'claude-opus-5', content: [] },
    }
    const undatedWithUsage = assistant({
      uuid: 'b',
      id: 'msg_1',
      ts: 'invalid',
      usage: { input: 100, output: 20 },
    })
    const file = fixture('dated-no-usage-then-undated-usage', [datedWithoutUsage, undatedWithUsage])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].dayLocal).toBe('2026-09-10')
    expect(entries[0].tsUtc).toBe('2026-09-10T10:00:00.000Z')
    expect(entries[0].inputTokens).toBe(100)
  })

  /**
   * A response with NO timestamp used to `return null` out of `toEntry`,
   * which deleted its tokens and its cost while the activity reducer and the
   * metadata parser still counted its message and its effort into the same
   * `UNDATED_DAY` bucket. All-time totals then grew by a message whose spend
   * had already vanished, and `undatedActivity` reported `responses: 0`
   * about responses the ledger had just discarded.
   *
   * These responses genuinely consumed tokens, so they are bucketed rather
   * than dropped. Asserting the token and cost figures — not merely
   * `toHaveLength(1)` — is the point: re-adding the drop, and equally
   * bucketing the response but zeroing what it spent, must both fail here.
   */
  it('keeps a response with no timestamp at all, with its tokens and cost, as undated', async () => {
    const file = fixture('missing-timestamp', [
      {
        ...assistant({ uuid: 'a', id: 'msg_1', usage: { input: 100, output: 20 } }),
        timestamp: '',
      },
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].dayLocal).toBe(UNDATED_DAY)
    // Retained exactly as written — `''` here, `undefined` in the next test —
    // rather than normalised into one sentinel: `dayLocal` is the field
    // entitled to treat both as undated, and it does.
    expect(entries[0].tsUtc).toBe('')
    expect(entries[0].inputTokens).toBe(100)
    expect(entries[0].outputTokens).toBe(20)
    expect(entries[0].costUsd).toBe(estimateCost('opus-5', 100, 20, 0, 0, 0, ANTHROPIC_PRICING))
  })

  /**
   * Same policy for a record that omits the `timestamp` key entirely rather
   * than carrying an empty string, and the identity fallback that branch now
   * reaches must be the same `uuid:`-prefixed key every other derivation of
   * this rule produces — see the `?? ''` note in `toEntry`. Without a uuid
   * AND without a timestamp that tail was `uuid:undefined` here while
   * `activity-reducer.ts` produced `uuid:`, a divergence that was harmless
   * only while this branch was unreachable.
   */
  it('keys an undated response with no uuid the same way every other derivation does', async () => {
    const record = assistant({ uuid: 'x', id: null, usage: { input: 7, output: 3 } })
    delete record.timestamp
    delete record.uuid
    const file = fixture('missing-timestamp-and-uuid', [record])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].responseId).toBe('uuid:')
    expect(entries[0].dayLocal).toBe(UNDATED_DAY)
    expect(entries[0].inputTokens).toBe(7)
  })
})

describe('ingestFile — records that are not billable responses', () => {
  it('skips synthetic assistant records', async () => {
    const file = fixture('synthetic', [
      assistant({ uuid: 'a', id: 'msg_1', model: '<synthetic>', usage: { input: 999 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(0)
  })

  it('skips user records', async () => {
    const file = fixture('user', [
      {
        type: 'user',
        uuid: 'u',
        timestamp: '2026-09-10T10:00:00.000Z',
        message: { content: 'hi' },
      },
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(0)
  })

  it('counts malformed lines instead of failing the ingest', async () => {
    const p = path.join(dir, 'malformed.jsonl')
    fs.writeFileSync(p, ['{not json', JSON.stringify(assistant({ uuid: 'a', id: 'm' }))].join('\n'))

    const { entries, malformedLines } = await ingestFile(p, PARENT, ANTHROPIC_PRICING)

    expect(malformedLines).toBe(1)
    expect(entries).toHaveLength(1)
  })
})

describe('ingestFile — identity and cost', () => {
  it('stamps each entry with its source identity', async () => {
    const file = fixture('identity', [assistant({ uuid: 'a', id: 'msg_1' })])
    const child: SourceIdentity = { ...PARENT, kind: 'subagent', agentId: 'agent-7' }

    const { entries } = await ingestFile(file, child, ANTHROPIC_PRICING)

    expect(entries[0]).toMatchObject({
      kind: 'subagent',
      agentId: 'agent-7',
      sessionId: 'sess-1',
      filePath: file,
    })
  })

  it('prices a recognised model at its own rates', async () => {
    const file = fixture('cost', [
      assistant({
        uuid: 'a',
        id: 'msg_1',
        model: 'claude-opus-5',
        usage: { input: 1_000_000, output: 1_000_000 },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    // Opus 5: $5 in + $25 out
    expect(entries[0].costUsd).toBeCloseTo(30, 10)
  })
})

/**
 * `requestId` was typed on `RawRecord` but never read anywhere — captured by
 * nothing, reaching nothing. Copying it onto the entry is what makes it
 * possible to reconcile a response against Anthropic's own request logs.
 */
describe('ingestFile — request id', () => {
  it('copies raw.requestId onto the entry', async () => {
    const file = fixture('request-id', [
      assistant({ uuid: 'a', id: 'msg_1', extra: { requestId: 'req_abc123' } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].requestId).toBe('req_abc123')
  })

  it('leaves requestId undefined when the record does not carry one', async () => {
    const file = fixture('no-request-id', [assistant({ uuid: 'a', id: 'msg_1' })])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].requestId).toBeUndefined()
  })
})

/**
 * Task 5: a missing, wrong-typed or non-finite counter became a priced `0`
 * with `usageIncomplete: false` — indistinguishable from a genuine `0`. Only
 * negatives were flagged. A response with `input_tokens: 10` and no
 * `output_tokens` was charged as though output were a measured zero.
 */
describe('ingestFile — absent and invalid counters are not a measured zero', () => {
  it('flags a response with input present and output entirely absent', async () => {
    const file = fixture('absent-output', [
      customAssistant({
        uuid: 'a',
        usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].inputTokens).toBe(10)
    expect(entries[0].outputTokens).toBe(0)
    expect(entries[0].usageIncomplete).toBe(true)
  })

  /**
   * The discriminating case, mirroring the negative-counter test above: a
   * response that genuinely reports 0 output tokens is complete data. If
   * "absent becomes invalid" were implemented by treating every 0 as
   * suspect, this would start flagging real, complete responses.
   */
  it('does not flag a response that genuinely reports zero output', async () => {
    const file = fixture('genuine-zero-output', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].outputTokens).toBe(0)
    expect(entries[0].usageIncomplete).toBe(false)
  })

  it('flags a wrong-typed counter the same way as a missing one', async () => {
    const file = fixture('wrong-type-output', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 10,
          output_tokens: '20', // a string, not a number
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].outputTokens).toBe(0)
    expect(entries[0].usageIncomplete).toBe(true)
  })

  /**
   * `cache_creation_input_tokens` and the whole `cache_creation` object are
   * legitimately absent on a response that made no cache write at all — a
   * documented shape, not missing data. Only a counter the API always
   * reports (input, output, cache read) is required.
   */
  it('does not flag a response that made no cache write at all', async () => {
    const file = fixture('no-cache-write', [
      customAssistant({
        uuid: 'a',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].cacheWriteFlat).toBe(0)
    expect(entries[0].usageIncomplete).toBe(false)
  })
})

/**
 * Task 9: every usage counter is validated through `requiredCounter`/
 * `optionalCounter` except `thinking_tokens`, which used to be read raw and
 * assigned straight through — a wrong type, a negative, or a value exceeding
 * `output_tokens` flowed unchecked into a separately displayed subtotal.
 */
describe('ingestFile — thinking-token counter validation', () => {
  it.each([
    ['a negative value', -5],
    ['a string', 'lots'],
    ['a non-finite value', Number.NaN],
  ])('drops %s rather than coercing it to a measured zero', async (_label, value) => {
    const file = fixture('thinking-invalid', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens_details: { thinking_tokens: value },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    // Dropped to `undefined` ("not reported"), never coerced to `0`
    // ("reported as zero") — those are different facts.
    expect(entries[0].thinkingTokens).toBeUndefined()
  })

  it('does not flag usageIncomplete for an invalid thinking-token count on its own', async () => {
    const file = fixture('thinking-invalid-not-incomplete', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens_details: { thinking_tokens: -5 },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    // Dropping the value is a complete fix on its own — nothing downstream
    // prices or totals a dropped thinking count, so there is no corrupted
    // number left in circulation for `usageIncomplete` to warn against.
    expect(entries[0].thinkingTokens).toBeUndefined()
    expect(entries[0].usageIncomplete).toBe(false)
  })

  it('keeps a valid thinking-token subtotal', async () => {
    const file = fixture('thinking-valid', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens_details: { thinking_tokens: 40 },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].thinkingTokens).toBe(40)
    expect(entries[0].usageIncomplete).toBe(false)
  })

  it('does not flag a response that never reports a thinking spend at all', async () => {
    const file = fixture('thinking-absent', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].thinkingTokens).toBeUndefined()
    expect(entries[0].usageIncomplete).toBe(false)
  })

  it('flags thinking tokens exceeding output as incomplete usage but keeps the value', async () => {
    const file = fixture('thinking-exceeds-output', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 10,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens_details: { thinking_tokens: 50 },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    // Thinking is a documented SUBSET of output, so this is a contradiction —
    // but it is the only observation this response gave us, so it is kept
    // rather than dropped, with `usageIncomplete` warning against trusting it.
    expect(entries[0].thinkingTokens).toBe(50)
    expect(entries[0].usageIncomplete).toBe(true)
  })

  /**
   * Task 9: `thinkingTokens` deliberately stays on the unconditional
   * "non-additive metadata refresh" policy (see the merge comment in
   * `ledger.ts`) rather than joining `ProvisionalField`/`provisionalFields` —
   * it is priced from nothing and never part of `stableUsageFingerprint`, so
   * a later valid observation transparently replacing an earlier invalid one
   * already gives the right outcome without a second bookkeeping mechanism.
   *
   * Task 9 review (finding 2): an earlier version of this file had the
   * INVALID-then-VALID direction here instead, which cannot discriminate
   * pre-fix from post-fix code — the merge line is `entry.thinkingTokens ??
   * existing.thinkingTokens`, and a later snapshot's value only ever loses
   * to `??` by being nullish, so whichever snapshot reports LAST always
   * wins regardless of whether an earlier invalid raw value was ever
   * scrubbed. The direction that actually depends on the fix is the
   * REVERSE: a valid count arriving first, then an invalid one arriving
   * LAST. Pre-fix, the raw unvalidated string would win via `??` (a string
   * is never nullish), silently overwriting the earlier valid measurement
   * with garbage. Post-fix, `toEntry` drops that later invalid observation
   * to `undefined` before the merge ever sees it, so `??` correctly falls
   * through to the still-valid earlier value.
   */
  it('keeps a valid thinking-token count when a later snapshot reports an invalid one', async () => {
    const file = fixture('thinking-later-invalid', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens_details: { thinking_tokens: 12 },
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens_details: { thinking_tokens: 'bad' },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].thinkingTokens).toBe(12)
    // Neither snapshot's own thinking value contradicted its own output, and
    // the invalid one was dropped rather than flagged — so nothing here
    // should be sticky-tainted.
    expect(entries[0].usageIncomplete).toBe(false)
  })
})

/**
 * Task 5: first-seen is the right policy for two CONTRADICTORY VALID
 * measurements (see "reprices a merged response" above) but the wrong policy
 * for a value that was never validly measured at all. Reproduction: the
 * first snapshot reports `input_tokens: 'bad'`, which `requiredCounter`
 * coerces to 0 while flagging it invalid; a later snapshot for the same
 * response reports 10. First-seen alone would keep the 0 forever even though
 * it was never a real measurement — this is the ruling that fixes that.
 */
describe('ingestFile — recovering a provisional field after an invalid first snapshot', () => {
  it('recovers a valid input count after an invalid first snapshot', async () => {
    const file = fixture('recover-input', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 'bad',
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    expect(entry.inputTokens).toBe(10)
    // Sticky — see `usageIncomplete`'s comment: the response was still
    // reported badly once, and recovering the field does not undo that.
    expect(entry.usageIncomplete).toBe(true)
  })

  it('reprices after recovering a provisional field', async () => {
    const file = fixture('recover-input-reprice', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 'bad',
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    // customAssistant defaults to opus-5: $5/MTok input, $25/MTok output.
    expect(entry.costUsd).toBeCloseTo(
      estimateCost('opus-5', 10, 5, 0, 0, 0, ANTHROPIC_PRICING)!,
      10
    )
  })

  it('still keeps the first of two valid contradictory measurements', async () => {
    const file = fixture('valid-conflict-unchanged', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    expect(entry.inputTokens).toBe(10)
    expect(entry.usageConflict).toBe(true)
  })

  it('recovers a model that the first snapshot did not report', async () => {
    const file = fixture('recover-model', [
      assistant({ uuid: 'a', id: 'm1', model: null, usage: { input: 10, output: 5 } }),
      assistant({ uuid: 'b', id: 'm1', model: 'claude-sonnet-5', usage: { input: 10, output: 5 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    expect(entry.modelFamily).toBe('sonnet-5')
    expect(entry.modelRaw).toBe('claude-sonnet-5')
    expect(entry.costUsd).not.toBeNull()
  })

  /**
   * The judgement call this task leaves open: `cache_creation`/
   * `cache_creation_input_tokens` are legitimately ABSENT on documented
   * response shapes (see "does not flag a response that made no cache write
   * at all" above) — that is exactly why `optionalCounter` reports
   * `invalid: false` for `undefined` rather than folding absence into the
   * same bucket as a present-but-garbage value. Chosen policy: absence is a
   * complete, valid measurement of "no cache write", not an unmeasured
   * value, so it is NOT provisional. A first snapshot that validly reports no
   * cache write and a later one that reports 10 are two valid, disagreeing
   * measurements — ordinary `usageConflict` territory, not a repair. The
   * alternative (treating absence as provisional) would let any later
   * snapshot silently inject cache-write tokens and cost into a response
   * that was never malformed in the first place.
   */
  it('does not treat a legitimately absent optional cache counter as provisional', async () => {
    const file = fixture('absent-cache-not-provisional', [
      customAssistant({
        uuid: 'a',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 10,
          cache_creation: { ephemeral_5m_input_tokens: 10 },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    expect(entry.cacheWriteFlat).toBe(0)
    expect(entry.cacheWrite5m).toBe(0)
    expect(entry.usageConflict).toBe(true)
  })

  /**
   * Review finding: `usageConflict` is order-dependent for one invalid and
   * one valid observation of the same field, and that asymmetry is
   * deliberate, not incidental — see the comment at the conflict check in
   * `ledger.ts`. Recovering an invalid first-seen value with a later valid
   * one copies the valid value onto `existing` before the fingerprints are
   * compared, so the two agree and no conflict is raised. A bad snapshot
   * arriving AFTER an already-valid one has nothing to recover — `existing`
   * keeps its untouched valid value — so the incoming invalid/coerced value
   * still disagrees with it and correctly raises `usageConflict`. Billing
   * and `usageIncomplete` are identical either way; only the conflict flag's
   * provenance differs.
   */
  it('usageConflict is order-dependent between an invalid and a valid observation, deliberately', async () => {
    const invalidThenValidFile = fixture('conflict-order-invalid-then-valid', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 'bad',
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])
    const validThenInvalidFile = fixture('conflict-order-valid-then-invalid', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 'bad',
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const [invalidThenValid] = (await ingestFile(invalidThenValidFile, PARENT, ANTHROPIC_PRICING))
      .entries
    const [validThenInvalid] = (await ingestFile(validThenInvalidFile, PARENT, ANTHROPIC_PRICING))
      .entries

    // Same recovered/retained billing input, and both orders carry the same
    // "reported badly once" provenance...
    expect(invalidThenValid.inputTokens).toBe(10)
    expect(validThenInvalid.inputTokens).toBe(10)
    expect(invalidThenValid.usageIncomplete).toBe(true)
    expect(validThenInvalid.usageIncomplete).toBe(true)

    // ...but only one arrival order raises usageConflict.
    expect(invalidThenValid.usageConflict).toBe(false)
    expect(validThenInvalid.usageConflict).toBe(true)
  })

  /**
   * Review finding: fields recover independently, so a recovered
   * `cacheWriteFlat` need not bring `cacheWrite5m`/`cacheWrite1h` with it.
   * Here the first snapshot's flat counter is invalid with no `cache_creation`
   * object at all, so the TTL tiers read as a legitimate, valid absence
   * (0/0 — see the judgement-call test above) and are never provisional. A
   * later snapshot recovers the flat counter to 100 with real tiers behind
   * it (60 5m + 40 1h), but the tiers stay first-seen at 0/0, so the whole
   * recovered 100 runs through `cacheWriteUnknownTtl`'s 5-minute fallback
   * instead of the true 60/40 split — understating cost against the 1h rate
   * for whatever portion of the write was actually 1h. This is the correct
   * consequence of "a validly-absent optional counter is never provisional",
   * not a bug to fix.
   */
  it("prices a recovered flat counter's remainder at the 5m fallback, not the true tier split", async () => {
    const file = fixture('recovered-flat-prices-5m-fallback', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 'bad',
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 100,
          cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    expect(entry.cacheWriteFlat).toBe(100)
    expect(entry.cacheWrite5m).toBe(0)
    expect(entry.cacheWrite1h).toBe(0)

    // opus-5: cache5m $6.25/MTok, cache1h $10/MTok.
    const pricedAsAllFallback = (100 / 1_000_000) * ANTHROPIC_PRICING['opus-5'].cache5m
    const trueTierSplit =
      (60 / 1_000_000) * ANTHROPIC_PRICING['opus-5'].cache5m +
      (40 / 1_000_000) * ANTHROPIC_PRICING['opus-5'].cache1h
    expect(entry.costUsd).toBeCloseTo(pricedAsAllFallback, 10)
    expect(entry.costUsd).not.toBeCloseTo(trueTierSplit, 10)
  })
})

/**
 * Task 5: the ledger priced only the tiers it knew about (40 of 100 flat
 * write tokens) and silently dropped the rest from actual cost, while
 * `analytics-engine.ts`'s cache premium and the what-if calculator already
 * estimated that same remainder at the 5-minute fallback rate — one response,
 * two dollar figures. Chosen policy: price the unexplained remainder at the
 * 5-minute rate everywhere, matching the fallback those other views already
 * used, rather than leaving it unpriced everywhere (which would understate
 * real spend on every partial-TTL response, common enough in older
 * transcripts that dropping the charge outright is worse than an estimate).
 */
describe('ingestFile — partial TTL is priced the same everywhere', () => {
  it('prices the flat write’s unexplained remainder at the 5-minute fallback rate', async () => {
    const file = fixture('partial-ttl', [
      assistant({ uuid: 'a', id: 'm1', model: 'claude-opus-5', usage: { flat: 100, cache5m: 40 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    // opus-5 cache5m rate: $6.25 / MTok. All 100 tokens — the 40 known plus
    // the 60 the tiers don't explain — priced at that one rate.
    const expected = (100 / 1_000_000) * ANTHROPIC_PRICING['opus-5'].cache5m
    expect(entry.costUsd).toBeCloseTo(expected, 10)
    // Still a tripwire: the tiers not adding up to the flat counter remains
    // worth flagging even though it is now priced consistently.
    expect(entry.usageIncomplete).toBe(true)
  })

  it('reprices a merged partial-TTL response consistently after output grows', async () => {
    const file = fixture('partial-ttl-merge', [
      assistant({
        uuid: 'a',
        id: 'm1',
        model: 'claude-opus-5',
        usage: { flat: 100, cache5m: 40, output: 1 },
      }),
      assistant({
        uuid: 'b',
        id: 'm1',
        model: 'claude-opus-5',
        usage: { flat: 100, cache5m: 40, output: 50 },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    const expectedCacheWriteCost = (100 / 1_000_000) * ANTHROPIC_PRICING['opus-5'].cache5m
    const expectedOutputCost = (50 / 1_000_000) * ANTHROPIC_PRICING['opus-5'].output
    expect(entry.costUsd).toBeCloseTo(expectedCacheWriteCost + expectedOutputCost, 10)
  })
})

/**
 * Task 4: the reproduction that found the defect. A response can report a
 * flat `cache_creation_input_tokens` SMALLER than its own TTL tiers — the
 * mirror image of the already-fixed "tiers smaller than flat" case above.
 * The tiers are the more specific measurement in that case and must win for
 * both the token volume (see projection.test.ts) and the price charged here:
 * pricing only the flat counter's 40 tokens while the tiers reported 100
 * silently undercharged by 60 tokens' worth of the cache-write rate.
 */
describe('ingestFile — tiers larger than the flat counter', () => {
  it('prices the full tier sum, not the smaller flat counter', async () => {
    const file = fixture('tiers-exceed-flat', [
      assistant({
        uuid: 'a',
        id: 'm1',
        model: 'claude-sonnet-5',
        usage: { flat: 40, cache5m: 100 },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    // sonnet-5 5-minute write rate: all 100 tier tokens priced there, not the
    // 40 the flat counter alone would price.
    const expected = (100 / 1_000_000) * ANTHROPIC_PRICING['sonnet-5'].cache5m
    expect(entry.costUsd).toBeCloseTo(expected, 10)
    const wrongIfFlatWon = (40 / 1_000_000) * ANTHROPIC_PRICING['sonnet-5'].cache5m
    expect(entry.costUsd).not.toBeCloseTo(wrongIfFlatWon, 10)
    // The mismatch is still worth flagging, same as the already-fixed case.
    expect(entry.usageIncomplete).toBe(true)
  })

  it('keeps pricing the tier sum after a merge reprices the response', async () => {
    const file = fixture('tiers-exceed-flat-merge', [
      assistant({
        uuid: 'a',
        id: 'm1',
        model: 'claude-sonnet-5',
        usage: { flat: 40, cache5m: 100, output: 1 },
      }),
      assistant({
        uuid: 'b',
        id: 'm1',
        model: 'claude-sonnet-5',
        usage: { flat: 40, cache5m: 100, output: 50 },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)
    const [entry] = entries

    // The merge path reprices from the retained (first-seen) cache fields
    // when output grows — it must reach the same tier-wins answer as the
    // single-snapshot case above, not silently fall back to the flat counter
    // the way a copied `Math.max(0, flat - tiers)` expression would.
    const expectedCacheWriteCost = (100 / 1_000_000) * ANTHROPIC_PRICING['sonnet-5'].cache5m
    const expectedOutputCost = (50 / 1_000_000) * ANTHROPIC_PRICING['sonnet-5'].output
    expect(entry.costUsd).toBeCloseTo(expectedCacheWriteCost + expectedOutputCost, 10)
  })
})

/**
 * Task 5: thinking spend, service tier, speed and inference geography only
 * refreshed inside the block gated on `output_tokens` growing — a later
 * snapshot reporting the SAME output but newly carrying one of these fields
 * dropped it. `model`/input/cache fields are deliberately excluded from this
 * fix: they stay first-seen on purpose (see the "reprices a merged response"
 * test above), because they're what `costUsd` is priced from.
 */
describe('ingestFile — late metadata refreshes independent of output growth', () => {
  it('picks up thinking tokens from a later snapshot reporting the same output', async () => {
    const file = fixture('late-thinking', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens_details: { thinking_tokens: 7 },
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].outputTokens).toBe(20)
    expect(entries[0].thinkingTokens).toBe(7)
  })

  it('picks up service tier, speed and inference geo from a later snapshot reporting the same output', async () => {
    const file = fixture('late-tier', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          service_tier: 'priority',
          speed: 'fast',
          inference_geo: 'eu',
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].serviceTier).toBe('priority')
    expect(entries[0].speed).toBe('fast')
    expect(entries[0].inferenceGeo).toBe('eu')
  })

  it('keeps an earlier snapshot’s metadata when a later one omits it', async () => {
    const file = fixture('late-metadata-not-cleared', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          service_tier: 'priority',
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].outputTokens).toBe(20)
    expect(entries[0].serviceTier).toBe('priority')
  })
})

/**
 * Task 5: a response's largest observed `output_tokens` is not the same
 * claim as a certified final one — Claude Code never marks a provisional
 * streaming snapshot any other way, so the only signal that a response
 * actually finished is a non-empty `stop_reason` on SOME snapshot. Measured
 * on real history, 8,436 of 30,073 response groups (28%) never carry one —
 * far too common to fold into `usageIncomplete`, whose real-history value is
 * asserted to be zero — so this is tracked as a separate provenance signal.
 */
describe('ingestFile — completion signal provenance', () => {
  it('marks a response with a non-empty stop_reason as carrying a completion signal', async () => {
    const file = fixture('has-stop-reason', [
      {
        type: 'assistant',
        uuid: 'a',
        timestamp: '2026-09-10T10:00:00.000Z',
        message: {
          role: 'assistant',
          id: 'm1',
          model: 'claude-opus-5',
          content: [],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 5,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].hasCompletionSignal).toBe(true)
  })

  it('marks a response with no non-empty stop_reason on any snapshot as without a completion signal', async () => {
    const file = fixture('no-stop-reason', [
      customAssistant({
        uuid: 'a',
        usage: {
          input_tokens: 5,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].hasCompletionSignal).toBe(false)
    // Absence of a completion signal is provenance, not a pricing defect —
    // it must not turn into a tripwire that fires on 28% of real history.
    expect(entries[0].usageIncomplete).toBe(false)
  })

  it('keeps a completion signal seen on an earlier snapshot even if a later one has none', async () => {
    const file = fixture('stop-reason-then-none', [
      {
        type: 'assistant',
        uuid: 'a',
        timestamp: '2026-09-10T10:00:00.000Z',
        message: {
          role: 'assistant',
          id: 'm1',
          model: 'claude-opus-5',
          content: [],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 5,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      customAssistant({
        uuid: 'b',
        usage: {
          input_tokens: 5,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].hasCompletionSignal).toBe(true)
  })
})

/**
 * Task 5: the `uuid:` fallback for a response with no `message.id` was
 * silent — nothing distinguished it from a normal, reconcilable id.
 */
describe('ingestFile — reduced-confidence response ids', () => {
  it('marks a response with no message.id as reduced-confidence and counts it once', async () => {
    const file = fixture('no-id-confidence', [
      assistant({ uuid: 'only', id: null, usage: { input: 42, output: 7 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries).toHaveLength(1)
    expect(entries[0].responseId).toBe('uuid:only')
    expect(entries[0].reducedConfidenceId).toBe(true)
  })

  it('does not mark a response carrying a real message.id as reduced-confidence', async () => {
    const file = fixture('has-id-confidence', [
      assistant({ uuid: 'a', id: 'msg_1', usage: { input: 42, output: 7 } }),
    ])

    const { entries } = await ingestFile(file, PARENT, ANTHROPIC_PRICING)

    expect(entries[0].reducedConfidenceId).toBe(false)
  })
})
