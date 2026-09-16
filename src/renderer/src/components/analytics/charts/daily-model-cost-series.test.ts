import { describe, expect, it } from 'vitest'
import type { DailyModelCost } from '@shared/types'
import { buildDailyModelCostSeries } from './daily-model-cost-series'

function row(date: string, model: string, cost: number): DailyModelCost {
  return { id: `${date}-${model}`, date, model, cost }
}

describe('buildDailyModelCostSeries', () => {
  it('without dateKeys, the date axis is only the dates that had cost (unchanged, pre-fix behaviour)', () => {
    const data = [row('2026-09-14', 'sonnet-5', 3)]

    const { dates, modelList, chartData } = buildDailyModelCostSeries(data)

    expect(dates).toEqual(['2026-09-14'])
    expect(modelList).toEqual(['sonnet-5'])
    expect(chartData).toEqual([{ date: '2026-09-14', 'sonnet-5': 3 }])
  })

  it('with dateKeys, an idle day with zero model cost still gets its own zero-filled column', () => {
    const data = [row('2026-09-09', 'sonnet-5', 3)]
    const dateKeys = [
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]

    const { dates, modelList, chartData } = buildDailyModelCostSeries(data, dateKeys)

    // The date axis now agrees with a 7-day `dailyUsage` series — not just
    // the 1 day that had model activity.
    expect(dates).toHaveLength(7)
    const idleRows = chartData.filter((r) => r.date !== '2026-09-09')
    expect(idleRows).toHaveLength(6)
    // No phantom model was invented to own the idle days' zero bars.
    expect(modelList).toEqual(['sonnet-5'])
    for (const r of idleRows) expect(r['sonnet-5']).toBe(0)
    expect(chartData.find((r) => r.date === '2026-09-09')?.['sonnet-5']).toBe(3)
  })

  it('does not fabricate a model dimension: an idle day never appears in modelList', () => {
    const data: DailyModelCost[] = []
    const dateKeys = ['2026-09-08', '2026-09-09']

    const { dates, modelList, chartData } = buildDailyModelCostSeries(data, dateKeys)

    expect(dates).toEqual(['2026-09-08', '2026-09-09'])
    expect(modelList).toEqual([])
    // Each row is just `{ date }` — no model columns to fabricate.
    expect(chartData).toEqual([{ date: '2026-09-08' }, { date: '2026-09-09' }])
  })

  it('does not move any cost figure: summing chartData still equals summing the input rows', () => {
    const data = [row('2026-09-08', 'opus-5', 3), row('2026-09-09', 'sonnet-5', 1)]
    const dateKeys = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09']

    const { modelList, chartData } = buildDailyModelCostSeries(data, dateKeys)

    const total = chartData.reduce(
      (sum, r) => sum + modelList.reduce((s, m) => s + Number(r[m] ?? 0), 0),
      0
    )
    expect(total).toBe(4)
  })
})
