import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { parseSessionMetadata } from './metadata-parser'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-parser-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

interface AssistantOpts {
  uuid: string
  id: string
  ts?: string
  model?: string
  input?: number
  output?: number
  cacheRead?: number
  cache5m?: number
}

function assistant(o: AssistantOpts): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: o.uuid,
    timestamp: o.ts ?? '2026-09-10T10:00:00.000Z',
    message: {
      id: o.id,
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
})
