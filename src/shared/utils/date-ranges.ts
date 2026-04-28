import type { DateRange, DateRangePreset, CustomDateRange } from '@shared/types/analytics'

/**
 * Returns [fromDate, toDate] for a given DateRange.
 * toDate is always "now" for presets.
 */
export function resolveDateRange(range: DateRange): { from: Date; to: Date } {
  const now = new Date()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  if (typeof range === 'string') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    switch (range as DateRangePreset) {
      case 'today':
        break
      case '7d':
        from.setDate(from.getDate() - 6)
        break
      case '30d':
        from.setDate(from.getDate() - 29)
        break
      case '90d':
        from.setDate(from.getDate() - 89)
        break
      case 'all':
        return { from: new Date(0), to }
    }
    return { from, to }
  }

  // Custom range — parse as local date (not UTC) and use full day boundaries
  const custom = range as CustomDateRange
  const [fy, fm, fd] = custom.from.split('-').map(Number)
  const [ty, tm, td] = custom.to.split('-').map(Number)
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
  const toDay = new Date(ty, tm - 1, td, 23, 59, 59, 999)
  if (from > toDay) throw new Error(`Invalid date range: ${custom.from} is after ${custom.to}`)
  return { from, to: toDay }
}

/**
 * Format a date as YYYY-MM-DD in *local* time. Used as a map key for daily
 * aggregations. Must match the local-time day boundaries produced by
 * `resolveDateRange`, otherwise sessions near midnight get bucketed into a
 * different day than the one the dashboard daypicker filters on.
 */
export function toDateKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Return all YYYY-MM-DD keys for a date range, inclusive. */
export function dateKeysInRange(from: Date, to: Date): string[] {
  const keys: string[] = []
  const current = new Date(from)
  current.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)

  while (current <= end) {
    keys.push(toDateKey(current))
    current.setDate(current.getDate() + 1)
  }
  return keys
}

/** True if the given ISO timestamp falls within the date range. */
export function isWithinRange(timestamp: string, from: Date, to: Date): boolean {
  const t = new Date(timestamp).getTime()
  return t >= from.getTime() && t <= to.getTime()
}
