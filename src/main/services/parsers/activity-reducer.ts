import type { RawRecord } from '@shared/types/session'
import { toDayKeyOrUndated, UNDATED_DAY } from '@shared/utils/date-ranges'
import { isToolResultCarrierUser, isSyntheticAssistant } from './parser-helpers'
import { assistantResponseId } from './response-observability'

/**
 * Counts conversational activity once per logical message.
 *
 * Claude Code writes one API response as one record per content block —
 * thinking, text and each tool_use land separately, sharing a `message.id` and
 * carrying byte-identical usage. Measured history: 6,378 of 9,750 parent
 * responses span two or more records, some up to 23. Counting records rather
 * than responses overstated messages by 2.09x. The ledger already collapses
 * these for usage; this does the same for activity.
 */
export interface DayActivity {
  user: number
  assistant: number
}

export interface ActivityCounts {
  userMessages: number
  assistantResponses: number
  /** userMessages + assistantResponses. */
  total: number
  byDay: Map<string, DayActivity>
}

export interface ActivityAccumulator {
  add(raw: RawRecord): void
  counts(): ActivityCounts
}

// `UNDATED_DAY` used to be declared here. It now lives in
// `@shared/utils/date-ranges` (alongside `toDayKeyOrUndated`, the one place
// that turns a raw timestamp into a day key) because `src/shared/**` cannot
// import from `src/main/**` — moving the constant the other way was not an
// option. Re-exported so existing importers of it from this module keep
// working unchanged.
export { UNDATED_DAY }

export function createActivityAccumulator(): ActivityAccumulator {
  const seenUuids = new Set<string>()
  const seenResponses = new Set<string>()
  // Which day bucket each already-counted response currently sits in. Lets a
  // later content-block record of the same response — one whose FIRST record
  // had no timestamp but a later one does — move the response out of the
  // undated bucket once better information arrives, rather than leaving it
  // stranded there for the rest of the file.
  const responseDay = new Map<string, string>()
  const byDay = new Map<string, DayActivity>()
  let userMessages = 0
  let assistantResponses = 0

  function bump(day: string, key: keyof DayActivity): void {
    const entry = byDay.get(day) ?? { user: 0, assistant: 0 }
    entry[key]++
    byDay.set(day, entry)
  }

  /**
   * Move one count from one day bucket to another without changing the total.
   *
   * A bucket emptied by the move is removed rather than left at zero. It only
   * existed to hold the count that just left, and a surviving `{user: 0,
   * assistant: 0}` entry is not the same claim as no entry: `dailyUsage` is
   * built from the union of the day keys these maps carry, so the leftover
   * produced a phantom all-zero `(undated)` row — a day in the series with no
   * messages, no tokens and no cost, counted in `dailyUsage.length` and
   * claiming an undated bucket exists for a response that was successfully
   * repaired out of it. Harmless while the ledger and the metadata parser had
   * no matching repair (they kept the response there, so the row was real);
   * visible the moment all three agree.
   */
  function moveBump(from: string, to: string, key: keyof DayActivity): void {
    const fromEntry = byDay.get(from)
    if (fromEntry) {
      fromEntry[key]--
      if (fromEntry.user === 0 && fromEntry.assistant === 0) byDay.delete(from)
    }
    bump(to, key)
  }

  return {
    add(raw: RawRecord): void {
      if (raw.isCompactSummary === true) return
      if (raw.type === 'progress') return
      if (raw.isVisibleInTranscriptOnly === true) return
      if (raw.uuid) {
        if (seenUuids.has(raw.uuid)) return
        seenUuids.add(raw.uuid)
      }

      // A message with no parsable timestamp is still real activity — Claude
      // Code wrote it — so it must still contribute to the lifetime count.
      // It just cannot be attributed to a calendar day. Silently leaving it
      // out of `byDay` while still counting it in the lifetime total is
      // exactly what broke `sum(dailyUsage.messageCount) === summary.messageCount`
      // before this fix; routing it through the same `bump` as everything
      // else, into an explicit `UNDATED_DAY` bucket, keeps both true. This is
      // not merely a lifetime-only fallback: `analytics-engine.ts`'s `all`
      // preset is defined to include this bucket in its own date-scoped
      // totals (the one range that can honestly claim it as part of
      // "everything"), while `7d`/`30d`/`90d`/custom exclude it from theirs —
      // it genuinely cannot be attributed to a calendar window. Either way it
      // is surfaced, never silently dropped: see `AnalyticsData.undatedActivity`,
      // which reports this count regardless of which preset is selected.
      // `toDayKeyOrUndated` also catches a *present but unparsable* timestamp
      // (the old `raw.timestamp ? toDateKey(...) : UNDATED_DAY` only checked
      // presence), so malformed timestamps land here too instead of producing
      // `NaN-NaN-NaN`.
      const day = toDayKeyOrUndated(raw.timestamp)

      if (raw.type === 'user') {
        if (isToolResultCarrierUser(raw)) return
        userMessages++
        bump(day, 'user')
        // No `responseDay`/`moveBump` repair here, unlike the assistant branch
        // below: a user turn is exactly one raw record (Claude Code splits an
        // API *response* across content-block records, never a user turn), so
        // there is no later fragment that could ever repair this one's date.
        return
      }

      if (raw.type !== 'assistant' || isSyntheticAssistant(raw)) return

      // One response, however many content records carried it. Shared with
      // `metadata-parser.ts` and `full-parser.ts` via `assistantResponseId` —
      // see that function's doc comment for why a response with no id keys
      // off its own record uuid instead of being dropped, and why `||` (not
      // `??`) is what keeps this in step with the ledger's own derivation.
      const responseId = assistantResponseId(raw)
      if (seenResponses.has(responseId)) {
        // A later content-block record of an already-counted response. If it
        // was provisionally placed in the undated bucket for lack of a
        // timestamp and this record carries one, repair the attribution
        // instead of leaving it stuck there — a later fragment fixing an
        // earlier fragment's missing date must not be silently dropped.
        const placedIn = responseDay.get(responseId)
        if (placedIn === UNDATED_DAY && day !== UNDATED_DAY) {
          moveBump(UNDATED_DAY, day, 'assistant')
          responseDay.set(responseId, day)
        }
        return
      }
      seenResponses.add(responseId)
      responseDay.set(responseId, day)
      assistantResponses++
      bump(day, 'assistant')
    },

    counts(): ActivityCounts {
      return {
        userMessages,
        assistantResponses,
        total: userMessages + assistantResponses,
        byDay,
      }
    },
  }
}
