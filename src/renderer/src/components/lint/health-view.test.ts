import { describe, expect, it } from 'vitest'
import type { LintResult } from '@shared/types'
import { countBySeverity, filterHealthResults, groupByArea, scoreLabel } from './health-view'

const r = (checkId: string, severity: LintResult['severity'], message = 'm'): LintResult =>
  ({ id: `${checkId}-${severity}`, checkId, severity, filePath: '', message }) as LintResult

const results = [
  r('CFG006', 'warning', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB not set'),
  r('SES006', 'warning', 'idle gap'),
  r('SEC007', 'warning', 'Platform Token found'),
  r('SEC002', 'error', 'AWS Access Key found'),
]

describe('health view helpers', () => {
  it('groups by area, secrets first and errors first inside a group', () => {
    const groups = groupByArea(results)
    expect(groups.map((g) => g.area)).toEqual(['Secrets', 'Sessions', 'Config'])
    expect(groups[0].results.map((x) => x.checkId)).toEqual(['SEC002', 'SEC007'])
  })

  it('filters by severity and by text in the id, message or area', () => {
    expect(filterHealthResults(results, 'error', '').map((x) => x.checkId)).toEqual(['SEC002'])
    expect(filterHealthResults(results, 'all', 'sessions').map((x) => x.checkId)).toEqual([
      'SES006',
    ])
    expect(filterHealthResults(results, 'all', 'scrub')).toHaveLength(1)
  })

  it('counts by severity', () => {
    expect(countBySeverity(results)).toEqual({ all: 4, error: 1, warning: 3, info: 0 })
  })

  it('labels the score by its colour band', () => {
    expect(scoreLabel(0.56)).toEqual({ pct: 56, label: 'Fair', tone: 'warning' })
    expect(scoreLabel(0.9).label).toBe('Good')
    expect(scoreLabel(0.2).label).toBe('Poor')
  })
})
