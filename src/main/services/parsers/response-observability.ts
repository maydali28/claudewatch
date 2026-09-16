import type {
  RawRecord,
  TurnDuration,
  EffortLevel,
  ErrorClassification,
} from '@shared/types/session'
import { MAX_TURN_DURATION_MS } from '@shared/constants/tuning'
import { parseInstant } from '@shared/utils/date-ranges'
import { classifyEffort, classifyError } from './parser-helpers'

/**
 * Response id a record belongs to. Claude Code writes one API response as
 * several records — thinking, text and each tool_use land separately — all
 * sharing `message.id`; a record without one keys off its own uuid so it is
 * never mistaken for continuing another response.
 *
 * Shared by every parser that groups records into responses
 * (`activity-reducer.ts`, `metadata-parser.ts` and `full-parser.ts` all call
 * this one) so the grouping can't drift between them. It used to be
 * copy-pasted by hand into each of them, which is exactly how `full-parser.ts`'s
 * message count silently fell out of step with the sidebar's before this
 * module existed.
 * `||`, not `??`: an empty-string `message.id` must fall through to the uuid
 * key too, agreeing with `ledger.ts`'s `id ? id : ...`, which already treats
 * an empty string as absent.
 */
export function assistantResponseId(raw: RawRecord): string {
  return raw.message?.id || `uuid:${raw.uuid ?? raw.timestamp ?? ''}`
}

/**
 * The chronologically later of two optional ISO timestamps.
 *
 * Compares via `parseInstant`, not a raw `new Date(...).getTime()` `>`
 * comparison: `NaN` fails every comparison, so `b > a` was `false` whenever
 * EITHER side was unparsable — including when `a` was the invalid one and
 * `b` a perfectly good timestamp, which silently returned the invalid `a`
 * and discarded the good value. A present, parseable timestamp must beat an
 * unparsable one regardless of which argument position it's in; only when
 * both are unparsable does this fall back to returning `b`, same as the
 * original's behaviour for that tied case.
 */
export function laterTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  const instantA = parseInstant(a)
  const instantB = parseInstant(b)
  if (instantA === null) return b
  if (instantB === null) return a
  return instantB > instantA ? b : a
}

/**
 * The response currently being assembled. Content blocks of one API response
 * arrive as separate records, so effort, error classification and turn
 * duration can only be judged once every record for that response has been
 * seen. A parser that needs more per-response state than this — e.g.
 * `metadata-parser.ts`'s parallel-tool-call `toolNames` — extends this shape
 * with its own fields rather than this module growing a field only one
 * caller uses.
 */
export interface PendingResponse {
  responseId: string
  timestamp?: string
  prevTimestamp?: string
  turnIndex: number
  outputTokens: number
  inputTokens: number
  model?: string
  stopReason?: string
  thinkingChars: number
  /**
   * Text content accumulated across every record of the response, for error
   * classification. Unlike `stop_reason` and `usage` (byte-identical on
   * every record of a response), text is scattered across blocks — a
   * thinking or tool_use record contributes none of it — so this has to be
   * built up record by record rather than read from any single one.
   */
  errorText: string
  isPostCompaction: boolean
}

export interface FlushedResponse {
  effort: EffortLevel
  errorClassification: ErrorClassification | null
  turnDuration?: TurnDuration
}

/**
 * Judge a completed response's effort, error classification and turn
 * duration exactly once, from the response's accumulated state rather than
 * from any single one of its records.
 *
 * `stop_reason` repeats byte-identical on every record of a response the
 * same way `usage` does. Classifying it per record — the original bug in
 * both `metadata-parser.ts` and `full-parser.ts` — pushed one
 * `maxTokensTruncation` entry per record instead of one per truncated
 * response, duplicating the truncation banner in the UI.
 *
 * Pure and side-effect-free: callers own applying the result to their own
 * accumulator (bumping a distribution, pushing to an array, merging
 * `lastMessageTimestamp`) since `metadata-parser.ts` and `full-parser.ts`
 * keep that state in different shapes and `metadata-parser.ts` additionally
 * attributes effort to a calendar day and folds in parallel-tool-call
 * detection, neither of which `full-parser.ts` does.
 */
export function judgeResponse(pending: PendingResponse): FlushedResponse {
  const effort = classifyEffort(pending.outputTokens, pending.thinkingChars, pending.stopReason)
  const errorClassification = classifyError(pending.errorText, pending.stopReason)

  let turnDuration: TurnDuration | undefined
  if (pending.prevTimestamp && pending.timestamp) {
    const durationMs =
      new Date(pending.timestamp).getTime() - new Date(pending.prevTimestamp).getTime()
    if (durationMs > 0 && durationMs <= MAX_TURN_DURATION_MS) {
      turnDuration = {
        turnIndex: pending.turnIndex,
        prevTimestamp: pending.prevTimestamp,
        assistantTimestamp: pending.timestamp,
        durationMs,
        isPostCompaction: pending.isPostCompaction,
        inputTokens: pending.inputTokens,
        model: pending.model,
      }
    }
  }

  return { effort, errorClassification, turnDuration }
}
