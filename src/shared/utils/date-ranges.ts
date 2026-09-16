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

/**
 * Supplements a day-keyed series with a zero row for every calendar day in
 * `[from, to]` that has no existing entry — the one place this codebase
 * turns "absent" into "present with zeros" for a day-keyed series. A series
 * built by only ever pushing an entry when a day HAS activity looks correct
 * until the first idle day: a "7d" selection with nothing logged yet today
 * renders as six days, not seven, because today's bar is missing rather than
 * zero. Feeding the result through this function once, in the one place a
 * series is assembled, is what lets every consumer — a chart's x-axis, an
 * average, a "how many days" count — agree on how many days the range has.
 *
 * ADDS, never DROPS: every entry already in `items` survives into the
 * result, including one dated outside `[from, to]`. `[from, to]` is only
 * where this function is willing to manufacture a zero row — it is not a
 * filter over `items`. This matters when `to` is a fill-only clamp narrower
 * than the range the caller actually resolved: `computeAnalytics` clamps its
 * fill's upper bound to today so it never fabricates a future-dated zero
 * row, but a genuinely future-dated response (clock skew, a timezone edge)
 * is real observed data, not a row this function invented — dropping it
 * silently would make `dailyUsage`'s sum disagree with the headline total
 * computed over the same, unclamped range. A caller that instead wants a
 * strict window — "only these days, whatever `items` contains" — must
 * filter `items` to that window itself before calling this function (see
 * `buildWeeklyUsage`, which does exactly that for its rolling 7-day view).
 *
 * Never call this for an unbounded range: `resolveDateRange('all')` returns
 * `from = new Date(0)`, and filling from 1970 would synthesise on the order
 * of twenty thousand empty days. Callers that support an `all`-equivalent
 * preset must gate this call themselves — this function has no opinion on
 * which range it was given and will happily fill any span it is handed.
 *
 * Never MANUFACTURES `UNDATED_DAY`: the fill keys come solely from
 * `dateKeysInRange`, which only ever emits real `YYYY-MM-DD` keys. An
 * `UNDATED_DAY` entry already present in `items`, though, now survives into
 * the result same as any other out-of-range entry (see "ADDS, never DROPS"
 * above) — a caller for whom that bucket must never appear (every bounded
 * preset) relies on `items` never containing it in the first place, not on
 * this function filtering it out.
 *
 * Generic over the item shape so both the main-process analytics engine
 * (`DailyUsage`, `DailyEffort`) and the renderer's tray popover
 * (`DailyUsagePoint`/`WeeklyUsagePoint`) can share this one implementation
 * instead of each hand-rolling the same map-and-fill.
 */
export function zeroFillDailySeries<T extends { date: string }>(
  items: T[],
  from: Date,
  to: Date,
  makeZero: (date: string) => T
): T[] {
  const byDate = new Map(items.map((item) => [item.date, item]))
  for (const date of dateKeysInRange(from, to)) {
    if (!byDate.has(date)) byDate.set(date, makeZero(date))
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
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
 * this replaces at the timestamp-ordering call sites that adopt it (the
 * "latest model" badge, the sessions table, the project list, and the CSV
 * export all used to compare text) — new call sites must opt in explicitly;
 * nothing enforces that every ordering comparison in the app goes through
 * this function.
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
