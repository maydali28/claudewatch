import { dateKeysInRange } from '@shared/utils/date-ranges'

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
 * The analytics daily series contains only days that had activity, and the tray
 * read its last two entries as today and yesterday. After a quiet weekend that
 * silently compared two days from the previous week, and with nothing logged
 * today the percentage was computed from two historical days while the headline
 * beside it correctly showed zero.
 *
 * Tokens are fresh input plus output, matching the tray headline; cache reads
 * are reported separately.
 */
export function buildWeeklyUsage(
  dailyUsage: DailyUsagePoint[],
  today: Date = new Date()
): WeeklyUsagePoint[] {
  const byDate = new Map(dailyUsage.map((d) => [d.date, d]))

  const end = new Date(today)
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - (WEEK_LENGTH - 1))

  return dateKeysInRange(start, end).map((date) => {
    const point = byDate.get(date)
    return {
      date,
      tokens: point ? point.inputTokens + point.outputTokens : 0,
      cost: point?.estimatedCost ?? 0,
    }
  })
}
