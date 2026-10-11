import { describe, expect, it, vi } from 'vitest'
import type { LintContext } from '@shared/types/lint'
import type { SecretFindingRecord } from '@shared/types/secrets'

import { secRules } from './sec.rules'

// Hoisted above the import: the rules module must not reach the app's store.
vi.mock('@main/services/secret-scan-service', () => ({ getSecretFindingsStore: () => null }))

const context = { claudeDir: '/c', settings: {} } as unknown as LintContext

const f = (over: Partial<SecretFindingRecord>): SecretFindingRecord => ({
  id: Math.random().toString(),
  fingerprint: 'x',
  checkId: 'SEC007',
  severity: 'warning',
  patternName: 'Platform Token',
  maskedValue: 'ghp_****Ab7c',
  projectId: 'p',
  sessionId: 's',
  foundAt: '2026-10-04T10:00:00.000Z',
  source: 'live',
  dismissed: false,
  ...over,
})

describe('secRules', () => {
  it('reports active findings, masked, with their transcript path', async () => {
    const results = await secRules(context, {
      findings: () => [
        f({ lineNumber: 4 }),
        f({ agentId: 'a1', foundAt: '2026-10-04T11:00:00.000Z' }),
        f({ dismissed: true }),
      ],
    })
    const secrets = results.filter((r) => r.checkId !== 'SEC008')
    expect(secrets).toHaveLength(2)
    expect(secrets[0]).toMatchObject({
      filePath: '/c/projects/p/s/subagents/agent-a1.jsonl',
      maskedSecret: 'ghp_****Ab7c',
    })
    expect(secrets[1]).toMatchObject({ filePath: '/c/projects/p/s.jsonl', line: 4 })
    expect(JSON.stringify(results)).not.toContain('contextLines')
    expect(results.some((r) => r.checkId === 'SEC008')).toBe(true)
  })

  it('reports nothing, and reads nothing, without findings', async () => {
    expect(await secRules(context, { findings: () => [] })).toEqual([])
  })
})
