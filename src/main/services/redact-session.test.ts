import { describe, expect, it } from 'vitest'
import type { ParsedSession } from '@shared/types/session'
import { redactParsedSession } from './redact-session'

const KEY = 'ghp_' + 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c'

function session(): ParsedSession {
  return {
    id: 's',
    projectId: 'p',
    records: [
      {
        type: 'assistant',
        uuid: 'a',
        isCompactionBoundary: false,
        contentBlocks: [
          { type: 'text', text: `token ${KEY}` },
          { type: 'thinking', thinking: KEY },
          {
            type: 'tool_use',
            id: 't',
            toolName: 'Bash',
            input: { command: `curl -H ${KEY}`, n: 1, nested: [KEY] },
          },
          { type: 'tool_result', toolUseId: 't', content: KEY, isError: false },
        ],
      },
    ],
    toolResultMap: { t: { content: `out ${KEY}`, isError: false } },
  } as unknown as ParsedSession
}

describe('redactParsedSession', () => {
  it('redacts every text-bearing field and leaves the original alone', () => {
    const raw = session()
    const out = redactParsedSession(raw, 'remove')
    expect(JSON.stringify(out)).not.toContain(KEY)
    expect(JSON.stringify(raw)).toContain(KEY)
    const input = (out.records[0].contentBlocks[2] as { input: Record<string, unknown> }).input
    expect(input.n).toBe(1)
  })

  it('returns the same object at none', () => {
    const raw = session()
    expect(redactParsedSession(raw, 'none')).toBe(raw)
  })
})
