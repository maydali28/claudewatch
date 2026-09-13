import { describe, expect, it } from 'vitest'
import { buildWeeklyUsage } from './weekly-usage'

const TODAY = new Date(2026, 8, 13) // 13 September 2026, local

/**
 * The daily series contains only days that had activity, and the tray treated
 * its last two entries as today and yesterday. After a quiet weekend that
 * compared two days from the previous week; with no activity today it compared
 * two historical days while the headline correctly read zero.
 */
describe('buildWeeklyUsage', () => {
  it('returns seven days ending today, whatever the data contains', () => {
    const week = buildWeeklyUsage([], TODAY)

    expect(week).toHaveLength(7)
    expect(week[0].date).toBe('2026-09-07')
    expect(week[6].date).toBe('2026-09-13')
  })

  it('fills days with no activity as zero rather than omitting them', () => {
    const week = buildWeeklyUsage(
      [{ date: '2026-09-13', inputTokens: 10, outputTokens: 5, estimatedCost: 1 }],
      TODAY
    )

    expect(week[6]).toEqual({ date: '2026-09-13', tokens: 15, cost: 1 })
    expect(week[5]).toEqual({ date: '2026-09-12', tokens: 0, cost: 0 })
  })

  it('puts yesterday in the penultimate slot even when only older days have data', () => {
    const week = buildWeeklyUsage(
      [
        { date: '2026-09-08', inputTokens: 900, outputTokens: 100, estimatedCost: 9 },
        { date: '2026-09-09', inputTokens: 400, outputTokens: 100, estimatedCost: 4 },
      ],
      TODAY
    )

    // Today and yesterday were both quiet: the comparison must be 0 against 0,
    // not last week's 500 against 1000.
    expect(week[6]).toEqual({ date: '2026-09-13', tokens: 0, cost: 0 })
    expect(week[5]).toEqual({ date: '2026-09-12', tokens: 0, cost: 0 })
  })

  it('ignores days outside the window', () => {
    const week = buildWeeklyUsage(
      [{ date: '2026-08-01', inputTokens: 999, outputTokens: 999, estimatedCost: 99 }],
      TODAY
    )

    expect(week.every((d) => d.tokens === 0)).toBe(true)
  })

  it('counts fresh input plus output, matching the tray headline', () => {
    const week = buildWeeklyUsage(
      [{ date: '2026-09-13', inputTokens: 3, outputTokens: 4, estimatedCost: 0.5 }],
      TODAY
    )

    expect(week[6].tokens).toBe(7)
  })
})
