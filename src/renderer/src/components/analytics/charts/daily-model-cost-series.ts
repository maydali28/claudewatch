import type { DailyModelCost } from '@shared/types'

export interface DailyModelCostRow {
  date: string
  [model: string]: string | number
}

export interface DailyModelCostSeries {
  /** Every date the chart should draw a column for, sorted ascending. */
  dates: string[]
  /** Every model that had cost on at least one of `dates`, input order. */
  modelList: string[]
  /** One row per date, one zero-filled column per model in `modelList`. */
  chartData: DailyModelCostRow[]
}

/**
 * Pivots (date, model, cost) rows into one row per date with one zero-filled
 * column per model — same shape `DailyModelCostChart` always rendered.
 *
 * `dateKeys`, when given, seeds the DATE axis with the full calendar range
 * (pass `AnalyticsData.dailyUsage`'s dates — see `analytics-engine.ts`,
 * where a bounded range is already zero-filled to exactly its calendar
 * span). Without it, an idle day with zero model activity was simply
 * missing from `data`, so the chart's own date axis silently ran shorter
 * than the selected range — the same "7d shows 6 days" defect `dailyUsage`
 * had, for this chart's date dimension specifically.
 *
 * The MODEL dimension is deliberately never synthesised: only a date that
 * already appears in `data` contributes to `modelList`. An idle day gets a
 * date column with every existing model zeroed, not a fabricated model of
 * its own — there is no natural "which model" for a day nothing happened
 * on, and inventing one would inject a phantom entry into the legend.
 */
export function buildDailyModelCostSeries(
  data: DailyModelCost[],
  dateKeys?: string[]
): DailyModelCostSeries {
  const dateSet = new Set<string>(dateKeys ?? [])
  const modelSet = new Set<string>()
  for (const row of data) {
    dateSet.add(row.date)
    modelSet.add(row.model)
  }

  const dates = Array.from(dateSet).sort()
  const modelList = Array.from(modelSet)

  const pivotMap = new Map<string, Record<string, number>>()
  for (const date of dates) {
    const entry: Record<string, number> = {}
    for (const model of modelList) entry[model] = 0
    pivotMap.set(date, entry)
  }
  for (const row of data) {
    pivotMap.get(row.date)![row.model] = row.cost
  }

  const chartData = dates.map((date) => ({ date, ...pivotMap.get(date) }))

  return { dates, modelList, chartData }
}
