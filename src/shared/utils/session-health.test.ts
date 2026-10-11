import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@shared/types/session'
import { evaluateSessionHealth, worstSeverity } from './session-health'

const NOW = Date.parse('2026-10-07T12:00:00Z')

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    estimatedCost: 1,
    totalInputTokens: 1000,
    totalOutputTokens: 1000,
    compactionCount: 0,
    lastTimestamp: '2026-10-07T11:00:00Z',
    messageCount: 10,
    hasError: false,
    observability: { errorClassifications: [], hasIdleZombieGap: false },
    ...over,
  } as unknown as SessionSummary
}

describe('evaluateSessionHealth', () => {
  it('passes a healthy session', () => {
    expect(evaluateSessionHealth(session(), NOW)).toEqual([])
  })

  it('lists every failing check, most important first', () => {
    const checks = evaluateSessionHealth(
      session({
        estimatedCost: 30,
        compactionCount: 6,
        lastTimestamp: '2026-09-01T00:00:00Z',
        observability: {
          errorClassifications: [],
          hasIdleZombieGap: true,
        } as unknown as SessionSummary['observability'],
      }),
      NOW
    )
    expect(checks.map((c) => c.checkId)).toEqual(['SES001', 'SES002', 'SES004', 'SES006'])
  })

  it('grades a rate-limited session an error', () => {
    const [check] = evaluateSessionHealth(
      session({
        hasError: true,
        observability: {
          errorClassifications: ['rateLimit'],
          hasIdleZombieGap: false,
        } as unknown as SessionSummary['observability'],
      }),
      NOW
    )
    expect(check).toMatchObject({ checkId: 'SES005', severity: 'error' })
  })
})

describe('worstSeverity', () => {
  it('picks the most severe', () => {
    expect(worstSeverity(['info', 'error', 'warning'])).toBe('error')
    expect(worstSeverity([])).toBeNull()
  })
})
