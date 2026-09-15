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

/**
 * Parses a raw transcript timestamp into its millisecond instant, or `null`
 * when it doesn't parse. `Date.parse` returns `NaN` for garbage input, and
 * every comparison against `NaN` is silently `false` — centralizing the
 * parse-and-check here stops call sites from writing an unguarded `>`/`<`
 * that ends up always winning or always losing depending on which operand
 * happens to be the malformed one.
 */
export function parseInstant(ts: string): number | null {
  const instant = Date.parse(ts)
  return Number.isNaN(instant) ? null : instant
}

/**
 * Ascending comparator over two raw transcript timestamps, for use with
 * `Array.prototype.sort`. Compares parsed instants rather than the raw text:
 * an offset-carrying timestamp (e.g. `+02:00`) can sort later than a `Z` one
 * as a string while naming an earlier instant, which is the exact defect
 * this replaces at every timestamp-ordering call site in the app (the "latest
 * model" badge, the sessions table, and the project list all used to compare
 * text).
 *
 * An unparseable timestamp is never evidence that a record is more recent
 * than a parseable one, so it sorts as though it happened at the dawn of
 * time — first when sorting ascending, last when sorting descending — the
 * same "cannot win on missing evidence" rule the badge uses, rather than
 * landing wherever `NaN`'s comparison semantics happen to put it.
 *
 * Deliberately branches (`===`/`<`) instead of subtracting the two instants:
 * both map to `-Infinity` when unparseable, and `-Infinity - -Infinity` is
 * `NaN` in IEEE-754, not `0` — a comparator that can return `NaN` breaks
 * `Array.prototype.sort`'s contract, and whether that visibly scrambles a
 * given array is implementation behavior, not something the spec promises.
 * Branching keeps every comparison in `{-1, 0, 1}`. Two unparseable
 * timestamps compare equal either way, and because `Array.prototype.sort` is
 * a stable sort, records that compare equal keep their relative input order,
 * so the comparator never has to break that tie itself.
 */
export function compareTimestampsAscending(a: string, b: string): number {
  const ta = parseInstant(a) ?? -Infinity
  const tb = parseInstant(b) ?? -Infinity
  if (ta === tb) return 0
  return ta < tb ? -1 : 1
}

/**
 * Bucket for activity with no parsable timestamp. Sorts before every real
 * `YYYY-MM-DD` day key lexically — undated activity cannot honestly be
 * attributed to a calendar day, so `analytics-engine.ts`'s `daysInRange`
 * excludes it from every calendar-bounded preset (`today`/`7d`/`30d`/`90d`/
 * custom) by that same lexical comparison, with no special-casing needed.
 * The `all` preset is the one exception: it is defined to mean "everything",
 * so it explicitly admits this bucket into its own totals instead of relying
 * on the comparison above — see `daysInRange`'s doc comment for how that is
 * threaded through without changing the comparison itself. Either way, the
 * count is surfaced rather than silently dropped or silently included; see
 * `AnalyticsData.undatedActivity`. Lives here, not in a parser, because the
 * ledger, the activity reducer and the analytics range filter must all agree
 * on it.
 */
export const UNDATED_DAY = '(undated)'

/**
 * The ONE way this codebase turns a raw transcript timestamp into a day key.
 * A present-but-unparsable timestamp is as undated as an absent one: the old
 * `raw.timestamp ? toDateKey(raw.timestamp) : UNDATED_DAY` checked presence,
 * not validity, so `'invalid'` produced the key `NaN-NaN-NaN` — a bucket no
 * range filter and no repair path could ever match.
 */
export function toDayKeyOrUndated(ts: string | undefined | null): string {
  if (!ts) return UNDATED_DAY
  return parseInstant(ts) === null ? UNDATED_DAY : toDateKey(ts)
}

/**
 * The IANA zone `toDateKey` is currently bucketing calendar days in. Stamped
 * on the metadata cache (see `metadata-cache.ts`) so that changing the
 * machine's timezone invalidates cached `dayLocal` figures instead of
 * silently mixing day boundaries from two zones into one history.
 */
export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
