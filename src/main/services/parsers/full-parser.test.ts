import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
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
