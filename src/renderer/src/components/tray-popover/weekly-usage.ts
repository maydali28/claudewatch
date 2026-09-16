import { zeroFillDailySeries, toDateKey } from '@shared/utils/date-ranges'

/** The subset of a daily-usage point the tray sparkline needs. */
export interface DailyUsagePoint {
  date: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
}

export interface WeeklyUsagePoint {
  date: string
  tokens: number
  cost: number
}

const WEEK_LENGTH = 7

/**
 * Seven calendar days ending today, with quiet days present as zeros.
 *
 * Originally the fix for a real bug: the analytics daily series used to
 * contain only days that had activity, and the tray read its last two
 * entries as today and yesterday. After a quiet weekend that silently
 * compared two days from the previous week, and with nothing logged today
 * the percentage was computed from two historical days while the headline
 * beside it correctly showed zero.
 *
 * `dailyUsage` (see `analytics-engine.ts`) is now zero-filled at the source
 * for every bounded range, `'7d'` included, so the input this function
 * receives is already complete in practice. The zero-fill here is kept
 * anyway as this function's own guarantee about its own output shape,
 * independent of what its caller happens to pass — see `zeroFillDailySeries`
 * (`@shared/utils/date-ranges`), the same helper `analytics-engine.ts` uses,
 * which is exactly why the tray and the analytics tab used to disagree
 * about how many days a week has and no longer do.
 *
 * Tokens are fresh input plus output, matching the tray headline; cache reads
 * are reported separately.
 *
 * `zeroFillDailySeries` only ADDS missing days now — it never drops an
 * out-of-window entry `items` already had (see its own doc comment: a
 * genuinely future-dated response must survive `computeAnalytics`'s fill,
 * not be silently discarded). This sparkline wants the opposite: a strict
 * seven-day window regardless of what stray dates `dailyUsage` contains, so
 * it filters to `[start, end]` itself before filling, rather than relying on
 * the shared helper to do that filtering for it.
 */
export function buildWeeklyUsage(
  dailyUsage: DailyUsagePoint[],
  today: Date = new Date()
): WeeklyUsagePoint[] {
  const end = new Date(today)
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - (WEEK_LENGTH - 1))

  const startKey = toDateKey(start)
  const endKey = toDateKey(end)
  const withinWindow = dailyUsage.filter((d) => d.date >= startKey && d.date <= endKey)

  const filled = zeroFillDailySeries(withinWindow, start, end, (date) => ({
    date,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
  }))

  return filled.map((point) => ({
    date: point.date,
    tokens: point.inputTokens + point.outputTokens,
    cost: point.estimatedCost,
  }))
}
