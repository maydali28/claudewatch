import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
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
 * Per the compaction docs, iteration usage is a separate ledger from top-level
 * usage. Adding both would trade one overcount for another.
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
