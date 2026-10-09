import { describe, expect, it } from 'vitest'
import { GetSubagentSchema } from './schemas'

const base = { sessionId: '0a2383fc-1ad1-4c00-a1f3-570c081ab20d', projectId: '-Users-me-repo' }

describe('GetSubagentSchema', () => {
  it('accepts a plain agent id', () => {
    expect(GetSubagentSchema.safeParse({ ...base, agentId: 'a049078820c88afe6' }).success).toBe(
      true
    )
  })

  it.each(['../x', 'a/b', 'a\\b', '', 'a.jsonl', 'x'.repeat(129)])('rejects %j', (agentId) => {
    expect(GetSubagentSchema.safeParse({ ...base, agentId }).success).toBe(false)
  })
})
