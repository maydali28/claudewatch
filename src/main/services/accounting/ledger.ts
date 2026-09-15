import * as fs from 'fs'
import * as readline from 'readline'
import type { RawRecord } from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { getModelFamily } from '@shared/constants/models'
import { estimateCost, PRICING_REVISION } from '@shared/constants/pricing'
import { toDayKeyOrUndated, UNDATED_DAY } from '@shared/utils/date-ranges'

/**
 * The accounting ledger: one entry per API response, not per transcript record.
 *
 * Claude Code writes a separate record for each content block of a response —
 * thinking, text, each tool_use — and every one of them repeats the same
 * `message.usage`. Summing per record overstated real usage by 3.5x across
 * measured history. Anthropic's own guidance is to count usage once per API
 * message id, which is what this module does.
 *
 * Everything downstream (totals, day buckets, model breakdowns, cost) is
 * derived from these entries. Nothing else in the app is permitted to add up
 * tokens.
 */

export interface SourceIdentity {
  kind: 'parent' | 'subagent'
  projectId: string
  sessionId: string
  /** Present only for subagent transcripts. */
  agentId?: string
}

export interface ResponseEntry {
  /** `message.id`, or `uuid:<record uuid>` when the response carries no id. */
  responseId: string
  /** Scopes `responseId`, and is the unit of invalidation and re-parse. */
  filePath: string
  kind: 'parent' | 'subagent'
  projectId: string
  sessionId: string
  agentId?: string
  /** `raw.requestId`, kept for provenance and reconciliation. Not every record carries one. */
  requestId?: string

  /**
   * This response's own timestamp — never the file's last.
   *
   * Optional, and `undefined` means the response carried no timestamp at all.
   * Such a response is no longer dropped (see `toEntry`): it is bucketed into
   * `UNDATED_DAY` like a present-but-unparsable one, so `dayLocal` is always
   * a usable key even when this is absent. Not collapsed to `''`, because
   * "never reported a timestamp" and "reported an unusable one" are different
   * facts and only `dayLocal` is entitled to treat them the same.
   */
  tsUtc?: string
  /** Calendar day the response is attributed to, in the reporting timezone. */
  dayLocal: string

  /** Exact model string as written, retained even when unrecognised. */
  modelRaw?: string
  modelFamily: ModelFamily

  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5m: number
  cacheWrite1h: number
  /** `cache_creation_input_tokens`, kept independently of the TTL split. */
  cacheWriteFlat: number
  /**
   * A subset of output tokens. Reported for display; never added to output.
   * `undefined` means the transcript never reported a thinking spend at all;
   * a present-but-invalid raw value (wrong type, non-finite, negative) is
   * dropped to `undefined` too rather than coerced to a misleading `0` — see
   * `toEntry` in this file. A value that exceeds `outputTokens` is kept
   * (there is nothing better to show) but flags `usageIncomplete`.
   */
  thinkingTokens?: number

  effortRecorded?: string
  serviceTier?: string
  speed?: string
  inferenceGeo?: string
  /**
   * Server-side iteration usage (compaction, advisor). Captured for
   * provenance only and never added to the totals above. See the detailed
   * comment above `iterations` in `toEntry` (ledger.ts) for why: for the
   * documented multi-iteration shape this app UNDERCOUNTS by keeping only
   * the top level, but summing unconditionally would instead OVERCOUNT the
   * ordinary single-iteration shape this app actually sees, where the one
   * iteration already equals the top level. Each element documents its own
   * `type` (e.g. `compaction`); a consumer that ever needs to interpret
   * these must key off that per-element type rather than assume the array
   * is homogeneous — measured history never has more than one element (see
   * the `usageIncomplete` tripwire below), so no such consumer exists yet.
   */
  iterationsRaw?: unknown

  /** How many transcript records carried this response. */
  snapshotCount: number
  /** True if a later record reported different usage for the same response. */
  usageConflict: boolean
  /**
   * True for a usage shape this ledger cannot price with confidence: tiers
   * that disagree with the flat cache-write counter, a server-side
   * `iterations` array of length > 1 (never observed — see `toEntry`), or a
   * required counter (input, output, cache read) that was missing, the wrong
   * type, non-finite, or negative. Tokens and cost are still counted for a
   * flagged response — see `UsageTotals.incompleteUsageResponses` — this is a
   * tripwire, not a filter.
   *
   * Sticky, and NOT cleared when `provisionalFields` later recovers a valid
   * value for a field that first read as invalid: this flag records that the
   * response was reported badly at least once, which recovering one field's
   * value does not undo. It is provenance about how the response arrived,
   * not a per-field error state that repairing the field resolves.
   */
  usageIncomplete: boolean
  /**
   * False when no snapshot of this response ever reported a non-empty
   * `stop_reason`. A completion signal means one was observed on SOME snapshot
   * of this response; the retained `outputTokens` is the MAXIMUM observed across
   * all snapshots; when a later provisional snapshot exceeds a completed one, the
   * flag and the number describe different observations. This is provenance —
   * where the information came from — never a certification that the output
   * figure is final or correct. Measured on real history: 8,436 of 30,073
   * response groups (28%) never carry a completion signal, so this is a real,
   * common gap, not a tripwire for data that doesn't occur — which is exactly
   * why it feeds a separate provenance count (`UsageTotals.responsesWithoutCompletionSignal`)
   * instead of `usageIncomplete`: folding a 28%-prevalence signal into the flag
   * whose real-history value is asserted to be zero would make that assertion
   * meaningless.
   */
  hasCompletionSignal: boolean
  /**
   * True when this response has no `message.id` and `responseId` fell back to
   * `uuid:<record uuid>`. That fallback key still groups this response's own
   * records correctly, but it cannot be reconciled against Anthropic's own
   * request logs the way a real `message.id` can, so callers presenting this
   * response's identity should show that reduced confidence rather than
   * implying it carries a normal API-issued id.
   */
  reducedConfidenceId: boolean

  /**
   * First-seen fields whose only observation, the last time this response was
   * (re)priced, was invalid data rather than a real measurement: a required
   * or optional counter `requiredCounter`/`optionalCounter` flagged
   * `invalid`, or a model string `getModelFamily` could not resolve. Absent
   * (undefined) on the entry once every first-seen field behind `costUsd` has
   * a genuine measurement — `toEntry` still builds a `Set` per record to find
   * that out, then discards it rather than attaching an empty one, so the
   * common case carries no `provisionalFields` here even though it was
   * momentarily allocated on the way in.
   *
   * `model`/input/cache fields stay first-seen deliberately (see the module
   * comment) because two VALID snapshots that disagree are a genuine
   * conflict worth preserving, not a defect to paper over. But a first
   * snapshot that never validly measured a field has nothing worth
   * defending — that's `usageIncomplete`'s job, not first-seen's — so the
   * first later snapshot reporting a valid value for exactly that field may
   * still fill it in. A field is removed from this set (and the entry's
   * value replaced) the moment a valid observation arrives for it; it is
   * never removed for any other reason, in particular never merely because
   * `usageIncomplete` is sticky (see that field's own comment).
   */
  provisionalFields?: Set<ProvisionalField>

  /** Null when the model is unrecognised and therefore cannot be priced. */
  costUsd: number | null
  /**
   * Provenance only — which numbered revision of the BUILT-IN pricing table
   * (`PRICING_REVISION`) `costUsd` was computed from. It does not reflect a
   * user's `pricingOverrides`: two entries with the same `pricingRevision`
   * can still be priced at different effective rates if a rate was
   * overridden in between. Nothing reads this back to decide cache validity
   * — that's `pricingFingerprint()` in `pricing-engine.ts`, which does cover
   * overrides. Don't repurpose this field for that; add a separate one.
   */
  pricingRevision: number
}

export interface IngestResult {
  entries: ResponseEntry[]
  /** Lines that failed to parse. Surfaced rather than silently swallowed. */
  malformedLines: number
  /** Responses with a raw usage counter rejected for being negative. See `num()` and `ResponseAccumulator.negativeCounters`. */
  negativeCounters: number
}

/**
 * Every usage field except output. Streaming records revise `output_tokens`
 * upward as the response is generated, so a difference there is expected; a
 * difference anywhere else is not, and stays worth flagging.
 */
function stableUsageFingerprint(e: ResponseEntry): string {
  return [e.inputTokens, e.cacheReadTokens, e.cacheWrite5m, e.cacheWrite1h, e.cacheWriteFlat].join(
    ':'
  )
}

/** A real, finite, non-negative number — the only shape a measured token count can take. */
function isMeasured(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * A usage counter the API always reports (input, output, cache read).
 * `undefined`, a wrong-typed value, `NaN`/`Infinity`, and a negative number
 * are all invalid data — not a smaller-than-usual measurement — and must not
 * be silently coerced into a measured `0`. Only a real, finite, non-negative
 * number is a measurement; that measurement can itself legitimately be `0`,
 * which is why `invalid` is tracked separately from `value` rather than the
 * caller inferring "invalid" from "reads as zero".
 */
function requiredCounter(value: unknown): { value: number; invalid: boolean } {
  return { value: isMeasured(value) ? value : 0, invalid: !isMeasured(value) }
}

/**
 * A usage counter whose absence is a legitimate, documented shape — no TTL
 * split reported (`cache_creation`), or no cache write at all
 * (`cache_creation_input_tokens`) — not missing data. A value that IS present
 * but unusable (wrong type, non-finite, negative) is bad data all the same
 * and must not be coerced to 0 silently either.
 */
function optionalCounter(value: unknown): { value: number; invalid: boolean } {
  if (value === undefined) return { value: 0, invalid: false }
  return requiredCounter(value)
}

/**
 * True when `value` was a real, finite number that was rejected for being
 * negative — as opposed to genuinely absent (`undefined`) or a legitimate 0,
 * neither of which is an error. Distinguishing the two is the point: a
 * response that reports 0 input tokens is complete, one that reports -500 and
 * has it zeroed is not. Kept separate from `requiredCounter`/`optionalCounter`
 * above (which fold negative into the broader "invalid" bucket that drives
 * `usageIncomplete`) because `ResponseAccumulator.negativeCounters()` is a
 * narrower, already-surfaced diagnostic specifically about negative values —
 * broadening its meaning without renaming it would make its own UI text
 * ("reported a negative value") false for a response flagged only for being
 * missing or the wrong type.
 */
function isRejectedNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value < 0
}

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  output_tokens_details?: { thinking_tokens?: number }
  iterations?: unknown
  service_tier?: string
  speed?: string
  inference_geo?: string
}

interface ToEntryResult {
  entry: ResponseEntry
  /** Raw counters on this record that were rejected for being negative. */
  negativeCounterFields: number
}

/** See `ResponseEntry.provisionalFields`. */
type ProvisionalField =
  'model' | 'inputTokens' | 'cacheReadTokens' | 'cacheWrite5m' | 'cacheWrite1h' | 'cacheWriteFlat'

/**
 * The write volume a response actually incurred, reconciling Anthropic's two
 * cache-write counters. `cache_creation_input_tokens` (the flat counter) is
 * normally authoritative, with the TTL split (`cache_creation.ephemeral_5m_input_tokens`
 * / `ephemeral_1h_input_tokens`) describing how it divides — that's the case
 * `cacheWriteUnknownTtl` below handles. But a response can instead report
 * tiers that sum to MORE than the flat counter; when that happens the tier
 * sum is the more specific measurement and wins, for both the token volume
 * reported and the dollars it is priced at. Pricing whichever is larger while
 * displaying whichever is smaller (or vice versa) — 40 tokens shown, 100
 * priced, for the same response — is the defect this function exists to
 * close. Every place that adds up or prices a cache write must go through it
 * rather than assuming the flat counter is always the ceiling.
 */
export function effectiveCacheWriteTotal(e: {
  cacheWriteFlat: number
  cacheWrite5m: number
  cacheWrite1h: number
}): number {
  return Math.max(e.cacheWriteFlat, e.cacheWrite5m + e.cacheWrite1h)
}

/**
 * The portion of `effectiveCacheWriteTotal` that no TTL tier explains.
 * Non-negative by construction: `effectiveCacheWriteTotal` can never be
 * smaller than `cacheWrite5m + cacheWrite1h`, so this subtraction never goes
 * negative the way a bare `cacheWriteFlat - cacheWrite5m - cacheWrite1h`
 * would when the tiers exceed the flat counter. In that exceeds case this is
 * exactly 0 — the tiers already account for the whole effective total, so
 * there is no unexplained remainder left to price at the 5-minute fallback.
 */
export function cacheWriteUnknownTtl(e: {
  cacheWriteFlat: number
  cacheWrite5m: number
  cacheWrite1h: number
}): number {
  return effectiveCacheWriteTotal(e) - e.cacheWrite5m - e.cacheWrite1h
}

/**
 * This ledger's derivation of the shared response-identity rule.
 *
 * `id ? id : ...`, not `id ?? ...`: an empty-string `message.id` must fall
 * through to the uuid key, same as the `||` fallbacks in
 * `activity-reducer.ts` and in `response-observability.ts`'s
 * `assistantResponseId` (the shared helper `metadata-parser.ts` and
 * `full-parser.ts` both call) — all four derivations of this same identity
 * must agree, or an empty id collapses every record sharing it into one
 * response here while another pass keeps them apart.
 *
 * `?? ''` on the tail, matching those derivations exactly. It used to be
 * absent, which was harmless only while `toEntry` dropped every record with
 * no timestamp, making the uuid-and-timestamp-both-absent branch unreachable;
 * an undated response is now kept, so that branch is live and must produce
 * the same `uuid:` key the others do rather than `uuid:undefined`.
 *
 * A named function rather than an expression inside `toEntry`, because
 * `add()` must key a record by the same rule BEFORE deciding whether that
 * record is one `toEntry` will ever see — a record with no `message.usage`
 * still belongs to a response, and can still carry the date that repairs it.
 * Two copies of this expression in one file is exactly the drift this whole
 * comment exists to prevent.
 */
function ledgerResponseId(raw: RawRecord): string {
  const id = raw.message?.id
  return id ? id : `uuid:${raw.uuid ?? raw.timestamp ?? ''}`
}

function toEntry(
  raw: RawRecord,
  usage: RawUsage,
  source: SourceIdentity,
  filePath: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): ToEntryResult | null {
  // An ABSENT timestamp used to `return null` here, dropping the response
  // before it could be given a day. That silently deleted its tokens and its
  // cost while the activity reducer and the metadata parser — which both
  // bucket the same response into `UNDATED_DAY` — still counted its message
  // and its effort, so `all`-time totals grew by the messages of a response
  // whose spend had already vanished, and `AnalyticsData.undatedActivity`
  // reported `responses: 0` while `messages` was non-zero. That combination
  // positively asserted "no response is undated" about responses this ledger
  // had just discarded, contradicting the policy `UNDATED_DAY`'s own doc
  // comment states: surfaced, never silently dropped.
  //
  // A response with no timestamp still consumed tokens and still cost money.
  // It is bucketed into `UNDATED_DAY` — exactly where a present-but-garbage
  // timestamp already went — so one response's messages, tokens and cost all
  // land in the same bucket, and so `all` (the one range that admits that
  // bucket) reports what was actually spent. Every calendar-bounded range
  // still excludes it by the untouched lexical comparison, because
  // `UNDATED_DAY` cannot honestly be attributed to a calendar day.
  //
  // Billing impact, stated deliberately rather than slipped in: lifetime
  // token and cost totals RISE for any corpus that contains such a response.
  // Measured history contains none — every timestamp-less record in the real
  // corpus is a sidecar type that `add()` has already filtered out before
  // reaching here — so `verify:accounting`'s numbers do not move.
  //
  // `toDayKeyOrUndated` handles both undated cases: an absent timestamp and a
  // present-but-unparsable one (a garbage string like `'invalid'` is truthy,
  // so the old check never saw it) both yield `UNDATED_DAY` rather than the
  // `NaN-NaN-NaN` key `toDateKey` would produce.
  const timestamp = raw.timestamp
  const dayLocal = toDayKeyOrUndated(timestamp)

  const modelRaw = raw.message?.model ?? undefined
  const modelFamily = getModelFamily(modelRaw)

  const inputC = requiredCounter(usage.input_tokens)
  const outputC = requiredCounter(usage.output_tokens)
  const cacheReadC = requiredCounter(usage.cache_read_input_tokens)
  const cache5mC = optionalCounter(usage.cache_creation?.ephemeral_5m_input_tokens)
  const cache1hC = optionalCounter(usage.cache_creation?.ephemeral_1h_input_tokens)
  const flatReported = usage.cache_creation_input_tokens !== undefined
  const flatC = optionalCounter(usage.cache_creation_input_tokens)

  const cacheWrite5m = cache5mC.value
  const cacheWrite1h = cache1hC.value
  // Prefer the reported aggregate; fall back to the tiers when it is absent so
  // a transcript without the flat counter still reports its cache writes.
  const cacheWriteFlat = flatReported ? flatC.value : cacheWrite5m + cacheWrite1h

  const inputTokens = inputC.value
  const outputTokens = outputC.value
  const cacheReadTokens = cacheReadC.value

  // `thinking_tokens` is legitimately absent on most transcripts — it long
  // predates this field — so it goes through `optionalCounter` rather than
  // `requiredCounter`, exactly like the cache-write counters above. But
  // unlike those (always-present `number` fields on `ResponseEntry`, where an
  // absence is correctly reported as a measured 0), `thinkingTokens` is
  // `number | undefined`: `undefined` means "this response never reported a
  // thinking spend" and `0` means "it reported a thinking spend of zero" —
  // two different facts that must not collapse into one. `optionalCounter`
  // returns the same `{ value: 0, invalid: false }` for both a genuinely
  // absent field and a validly-reported zero, so that distinction has to be
  // recovered here from whether the raw field was present at all, not from
  // `optionalCounter`'s own return value.
  const thinkingRaw = usage.output_tokens_details?.thinking_tokens
  const thinkingReported = thinkingRaw !== undefined
  const thinkingC = optionalCounter(thinkingRaw)
  // An invalid thinking-token count (wrong type, non-finite, negative) is
  // dropped rather than coerced to 0 — 0 would silently claim "reported as
  // zero", which is not what happened. Unlike the counters above, nothing
  // downstream prices or totals this field on its own (see
  // `UsageTotals.thinkingTokens` in `projection.ts`), so there is no
  // corrupted stand-in value left in circulation once it's dropped — that is
  // why, unlike an invalid required/cache counter, an invalid thinking-token
  // count does NOT itself count toward `invalidCounterFields`/`usageIncomplete`
  // below: there is nothing left for that flag to warn a consumer away from.
  const thinkingTokens = thinkingReported && !thinkingC.invalid ? thinkingC.value : undefined
  // Thinking tokens are a documented SUBSET of output tokens, so reporting
  // more thinking spend than total output is a contradiction, not a
  // smaller-than-usual measurement. There is no better number to fall back
  // on — this contradictory pair is the only observation this response gave
  // us — so the value is kept rather than dropped; `usageIncomplete` below is
  // what tells a consumer not to trust it.
  const thinkingExceedsOutput = thinkingTokens !== undefined && thinkingTokens > outputTokens

  // Missing, wrong-typed, non-finite or negative — any of these on a counter
  // means the number this pipeline is now working with is not the one the
  // response actually reported, whether or not that number happens to be
  // negative. `input_tokens`/`output_tokens`/`cache_read_input_tokens` are
  // always reported by the API, so their absence is invalid the same as a bad
  // type would be; the cache-write fields are legitimately absent on their
  // own documented shapes (see `optionalCounter`), so only a PRESENT-but-bad
  // value there counts.
  const invalidCounterFields = [inputC, outputC, cacheReadC, cache5mC, cache1hC, flatC].filter(
    (c) => c.invalid
  ).length

  // Checked against the raw fields, not the already-zeroed values above: by
  // the time the counter helpers above have run, a rejected -500 and a
  // genuinely absent counter both read as 0 and are no longer distinguishable.
  const negativeCounterFields = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_creation?.ephemeral_5m_input_tokens,
    usage.cache_creation?.ephemeral_1h_input_tokens,
  ].filter(isRejectedNegative).length

  // One policy for reconciling the flat write counter against its TTL tiers,
  // applied everywhere this ledger and `analytics-engine.ts` price a cache
  // write — see `effectiveCacheWriteTotal`/`cacheWriteUnknownTtl` above. When
  // the flat counter is larger, its unexplained remainder is priced at the
  // 5-minute rate, the cheaper of the two and the fallback `cache-tab`/
  // what-if calculator already use for this exact remainder (see
  // `computeCacheAnalytics`'s `writePremium` and `whatif-calculator.tsx`'s
  // `projectCost`). When the TTL tiers are larger instead, they already
  // account for the whole effective total on their own (`cacheWriteUnknownTtl`
  // is 0), so the tier rates below price all of it and nothing is added here.
  // Previously this ledger priced ONLY the known tiers and silently dropped
  // the remainder from actual cost while those other views still estimated
  // it — the same response then had two different dollar figures.
  const unknownTtl = cacheWriteUnknownTtl({ cacheWriteFlat, cacheWrite5m, cacheWrite1h })
  const costUsd = estimateCost(
    modelFamily,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWrite5m + unknownTtl,
    cacheWrite1h,
    pricingTable
  )

  const responseId = ledgerResponseId(raw)
  const reducedConfidenceId = !raw.message?.id

  const stopReason = raw.message?.stop_reason
  const hasCompletionSignal = typeof stopReason === 'string' && stopReason.length > 0

  // Two shapes below cannot be priced with confidence: a tier/flat mismatch,
  // and a multi-iteration `iterations` array. Neither occurs in measured
  // history — 0 tier mismatches in 25,661 responses, and all 29,556
  // iteration arrays have length 1 with the top level equal to that single
  // iteration — so both are tripwires, not corrections for data known to
  // exist.
  //
  // The iterations case, spelled out, because a past review of this exact
  // code misread it once already: Anthropic documents that a server-side
  // compaction response's usage can carry an `iterations` array, and for
  // that documented shape the TOP-LEVEL `input`/`output` counters EXCLUDE
  // the compaction iterations — summing every entry in `iterations` is what
  // gives the full request usage.
  // https://platform.claude.com/docs/en/build-with-claude/compaction#understanding-usage
  // This ledger keeps only the top-level counters and sets `usageIncomplete`
  // instead of summing, so for that documented shape it UNDERCOUNTS the
  // response — it does not overcount it. That gap is deliberate, not an
  // oversight: no transcript in measured history exercises a response with
  // more than one iteration, so there is no data to validate
  // iteration-summing accounting against, and an untested change to real
  // billing arithmetic is a worse outcome than a documented gap.
  //
  // Do NOT close that gap by summing `iterations` on top of the top-level
  // counters unconditionally. The earlier review's finding that iterations
  // are "omitted" must not be read as license to add them back in every
  // case: in the shape this app actually sees — all 29,556 measured
  // arrays — length is 1 and that single iteration already equals the top
  // level, because it IS the top-level request, merely echoed into the
  // array. Adding it again would double-count the main iteration (measured:
  // it would have doubled 7.6B cache-read tokens), trading a real, constant
  // overcount for a hypothetical undercount that has never once occurred.
  // `iterations.length > 1` is therefore the only iteration signal folded
  // into `usageIncomplete` below: it is the one case where the top-level
  // counters are known to be missing data rather than merely repeating it.
  //
  // An invalid required counter, by contrast, is not a tripwire for
  // hypothetical data: it's the same defect class the negative-counter check
  // already covers, widened to catch missing and wrong-typed values it let
  // through as a measured zero before.
  const tiers = cacheWrite5m + cacheWrite1h
  const iterations = Array.isArray(usage.iterations) ? usage.iterations : undefined
  //
  // `thinkingExceedsOutput` joins this OR-chain for the reason explained
  // where it's computed above: it's a valid-but-contradictory observation
  // that is kept rather than dropped, so this flag is the only signal that
  // tells a consumer not to trust it.
  const usageIncomplete =
    (tiers > 0 && cacheWriteFlat !== tiers) ||
    (iterations !== undefined && iterations.length > 1) ||
    invalidCounterFields > 0 ||
    thinkingExceedsOutput

  // Fields this SNAPSHOT never validly measured — see
  // `ResponseEntry.provisionalFields`. Absence (the cache-write fields'
  // documented legitimate shape) is deliberately excluded: `optionalCounter`
  // already reports `invalid: false` for it, so a response that made no
  // cache write at all is complete data, not a candidate for a later
  // snapshot to overwrite.
  const provisionalFields = new Set<ProvisionalField>()
  if (modelFamily === 'unknown') provisionalFields.add('model')
  if (inputC.invalid) provisionalFields.add('inputTokens')
  if (cacheReadC.invalid) provisionalFields.add('cacheReadTokens')
  if (cache5mC.invalid) provisionalFields.add('cacheWrite5m')
  if (cache1hC.invalid) provisionalFields.add('cacheWrite1h')
  if (flatC.invalid) provisionalFields.add('cacheWriteFlat')

  return {
    entry: {
      responseId,
      filePath,
      kind: source.kind,
      projectId: source.projectId,
      sessionId: source.sessionId,
      agentId: source.agentId,
      requestId: raw.requestId,
      tsUtc: timestamp,
      dayLocal,
      modelRaw,
      modelFamily,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWrite5m,
      cacheWrite1h,
      cacheWriteFlat,
      thinkingTokens,
      effortRecorded: typeof raw.effort === 'string' ? raw.effort : undefined,
      serviceTier: usage.service_tier,
      speed: usage.speed,
      inferenceGeo: usage.inference_geo,
      iterationsRaw: usage.iterations,
      snapshotCount: 1,
      usageConflict: false,
      usageIncomplete,
      provisionalFields: provisionalFields.size > 0 ? provisionalFields : undefined,
      hasCompletionSignal,
      reducedConfidenceId,
      costUsd,
      pricingRevision: PRICING_REVISION,
    },
    negativeCounterFields,
  }
}

export interface ResponseAccumulator {
  /** Feed one raw transcript record. Non-billable records are ignored. */
  add(raw: RawRecord): void
  /** Deduplicated responses seen so far. */
  entries(): ResponseEntry[]
  /**
   * Responses seen so far that had at least one raw usage counter rejected
   * for being negative — deduplicated by response, the same as `entries()`.
   * Claude Code writes one record per content block (thinking, text, each
   * tool_use), all repeating the same `message.usage`, so counting per
   * record would report a single bad response as N counters — the exact
   * per-record overcount this whole ledger exists to eliminate. A response
   * with several negative fields on it (e.g. both input and cache-read)
   * still counts once: this answers "how many responses need attention",
   * matching how `incompleteUsageResponses` counts responses rather than
   * flagged fields.
   */
  negativeCounters(): number
}

/**
 * Accumulates billable responses from a stream of raw records.
 *
 * Exposed separately from `ingestFile` so a caller that is already iterating a
 * transcript — the metadata parser, which also collects timings, tool calls and
 * compaction events — can feed the ledger from that same pass instead of
 * reading every file twice.
 */
export function createResponseAccumulator(
  filePath: string,
  source: SourceIdentity,
  pricingTable: Record<ModelFamily, ModelPricing>
): ResponseAccumulator {
  const byResponseId = new Map<string, ResponseEntry>()
  const seenRecordUuids = new Set<string>()
  // A Set of response ids, not a running tally: adding the same responseId
  // from several block-split records of one response is idempotent, so this
  // naturally counts distinct responses no matter how many records or
  // negative fields any one of them carried.
  const negativeCounterResponseIds = new Set<string>()

  /**
   * The first usable timestamp ANY record of a response carried — including
   * records this ledger will never build an entry from.
   *
   * `add()` admits a record to `toEntry` only if it has `message.usage`. The
   * activity reducer and the metadata parser have no such requirement, so a
   * later, correctly-dated record with no usage repaired the response's day
   * in those two producers while this ledger left the response in
   * `(undated)` — reproducing the exact split the unified repair had just
   * closed, through a slightly different door: a calendar day showing
   * messages and $0.00 of spend.
   *
   * The usage check is an admission rule for CREATING an entry, not a reason
   * to ignore a date correction for a response that already exists or is
   * about to. Recording the date here, before that check, keeps the ledger's
   * notion of "this response's day" independent of which of its records
   * happened to carry usage — and independent of arrival order, which the
   * merge-path repair alone could not be: a dated usage-less record arriving
   * BEFORE the undated usage-carrying one left nothing for a later merge to
   * repair from.
   *
   * First usable wins, not last, matching every other producer's first-seen
   * attribution for a response that was correctly dated all along.
   */
  const datedByResponseId = new Map<string, string>()

  /**
   * Move an entry out of `UNDATED_DAY` onto the best date known for its
   * response. One-directional, like `activity-reducer.ts`'s `moveBump`: a
   * response only ever leaves the undated bucket, never enters it, so a
   * garbage timestamp on one record cannot erase a good attribution. Called
   * on creation and on merge so the repair does not depend on which record
   * arrived first. `dayLocal` and `tsUtc` move together, so an entry's day
   * and its own timestamp always agree.
   */
  function repairDayLocal(entry: ResponseEntry): void {
    if (entry.dayLocal !== UNDATED_DAY) return
    const known = datedByResponseId.get(entry.responseId)
    if (known === undefined) return
    entry.dayLocal = toDayKeyOrUndated(known)
    entry.tsUtc = known
  }

  // Price an entry from the fields it currently retains, through the same
  // `cacheWriteUnknownTtl` helper `toEntry` prices from — not a copy of its
  // formula. A copy is exactly how a previous repricing spot here drifted:
  // it clamped the flat/tier difference at 0 for the "tiers exceed flat"
  // case by accident of `Math.max(0, …)`, but never reflected that a tier
  // sum larger than the flat counter should raise the volume being priced,
  // not just avoid going negative. Both places that reprice a merged
  // response — the output-growth block and the provisional-field recovery
  // below — call this one function instead of each writing the expression.
  function repriceFromRetainedFields(e: ResponseEntry): number | null {
    const unknownTtl = cacheWriteUnknownTtl(e)
    return estimateCost(
      e.modelFamily,
      e.inputTokens,
      e.outputTokens,
      e.cacheReadTokens,
      e.cacheWrite5m + unknownTtl,
      e.cacheWrite1h,
      pricingTable
    )
  }

  return {
    add(raw: RawRecord): void {
      if (raw.type !== 'assistant') return
      if (raw.isCompactSummary === true) return
      if (raw.isVisibleInTranscriptOnly === true) return
      if (raw.message?.model === '<synthetic>') return

      // A repeated record uuid is the same stored record seen twice, which is a
      // different thing from two records sharing one response.
      if (raw.uuid) {
        if (seenRecordUuids.has(raw.uuid)) return
        seenRecordUuids.add(raw.uuid)
      }

      // Before the usage gate below, deliberately: a record with no
      // `message.usage` still belongs to a response and can still carry the
      // date that repairs it. See `datedByResponseId`.
      const recordResponseId = ledgerResponseId(raw)
      if (
        raw.timestamp !== undefined &&
        toDayKeyOrUndated(raw.timestamp) !== UNDATED_DAY &&
        !datedByResponseId.has(recordResponseId)
      ) {
        datedByResponseId.set(recordResponseId, raw.timestamp)
      }
      // Repair a response this ledger has already built, even from a record
      // it is about to turn away for having no usage.
      const alreadyBuilt = byResponseId.get(recordResponseId)
      if (alreadyBuilt) repairDayLocal(alreadyBuilt)

      const usage = raw.message?.usage as RawUsage | undefined
      if (!usage) return

      const result = toEntry(raw, usage, source, filePath, pricingTable)
      if (!result) return
      const { entry, negativeCounterFields } = result
      if (negativeCounterFields > 0) negativeCounterResponseIds.add(entry.responseId)

      const existing = byResponseId.get(entry.responseId)
      if (!existing) {
        // A date an EARLIER record supplied applies to the entry this record
        // creates, not only to one it merges into — otherwise a dated
        // usage-less record arriving first leaves nothing to repair from.
        repairDayLocal(entry)
        byResponseId.set(entry.responseId, entry)
        return
      }

      // Merge, rather than pick. Streaming transcripts — every subagent file in
      // measured history, 5,780 of 24,661 responses — emit provisional records
      // whose output_tokens is a placeholder (1, 2, 3) with a null stop_reason,
      // followed by a final record carrying the real count. Output only ever
      // grows, so the largest is the completed one; taking the first would
      // undercount subagent output by orders of magnitude.
      existing.snapshotCount++

      // Non-additive metadata a later snapshot can newly report or correct —
      // thinking spend, tier, speed, geography, server-side iterations — is
      // NOT byte-identical across every snapshot the way `stableUsageFingerprint`'s
      // fields are, so it must not wait on `outputTokens` growing to be kept.
      // Previously these only refreshed inside the growth-gated block below,
      // which dropped e.g. a `thinking_tokens` that arrived on a snapshot
      // reporting the SAME output as one already seen. `model`/input/cache
      // fields are deliberately excluded from this list — see the module
      // comment and the "reprices a merged response" test: those stay
      // first-seen on purpose, because they're what `costUsd` is priced from.
      //
      // `thinkingTokens` deliberately stays on this unconditional-refresh
      // policy rather than joining `ProvisionalField`/`provisionalFields`:
      // that machinery exists to let a later VALID observation replace a
      // first-seen INVALID one for fields `costUsd` is priced from, where
      // getting the recovery ordering and conflict bookkeeping exactly right
      // matters. `thinkingTokens` is priced from nothing (see its own field
      // comment) and never contributes to `stableUsageFingerprint`, so two
      // valid-but-differing observations have no conflict worth preserving —
      // the simpler "latest reported value wins, an invalid one having
      // already been dropped to `undefined` by `toEntry` above" rule this
      // line already implements gives the same practical outcome (an invalid
      // first snapshot's `undefined` is transparently replaced by a later
      // valid number) without a second bookkeeping mechanism to keep in sync
      // with this one.
      existing.thinkingTokens = entry.thinkingTokens ?? existing.thinkingTokens
      existing.serviceTier = entry.serviceTier ?? existing.serviceTier
      existing.speed = entry.speed ?? existing.speed
      existing.inferenceGeo = entry.inferenceGeo ?? existing.inferenceGeo
      existing.iterationsRaw = entry.iterationsRaw ?? existing.iterationsRaw
      // A completion signal seen on any snapshot is RECORDED for the response,
      // even if an earlier or later one carried an empty `stop_reason` —
      // sticky, like `usageIncomplete`, and for the same reason: it must never
      // be un-set by a later snapshot that happens to look less certain.
      //
      // "Recorded", not "certified": this says a stop reason was observed on
      // SOME snapshot, while `outputTokens` above is the MAXIMUM across all of
      // them. A later provisional snapshot can exceed the one that carried the
      // stop reason, so the flag and the figure may describe different
      // observations. It is provenance, never a guarantee the output is final.
      existing.hasCompletionSignal = existing.hasCompletionSignal || entry.hasCompletionSignal

      // Relocate a response out of `UNDATED_DAY` when a later record of it
      // carries a usable timestamp — the same repair `activity-reducer.ts`
      // performs with `moveBump`, which this ledger previously had no
      // equivalent of.
      //
      // Without it the bucketing policy was unified but the REPAIR was not,
      // and the two disagreed on the same response: the reducer moved its
      // MESSAGES onto the real calendar day while this ledger left its
      // TOKENS and COST behind in `(undated)`. A day then showed messages
      // with no spend, and `(undated)` showed spend with no messages — one
      // response's accounting split across two buckets, which is exactly
      // what a single shared undated policy exists to prevent. Totals under
      // `all` were right either way; only the attribution split, and only a
      // calendar-bounded range could see it.
      //
      // Not the first-seen-wins rule the model and counter fields follow,
      // because there is no measurement being defended: the first record
      // reported nothing usable, so a later usable one is a repair, not a
      // second disagreeing observation. Neither field is part of
      // `stableUsageFingerprint`, so no conflict is raised for either.
      //
      // Goes through `repairDayLocal` rather than comparing against `entry`
      // directly, so this path and the creation path above share one rule
      // and one source of dates — including dates from records that never
      // become an `entry` at all.
      repairDayLocal(existing)

      // Recover a first-seen field whose only observation so far was invalid
      // data — see `ResponseEntry.provisionalFields`. This runs before the
      // output-growth block below (and before the conflict check further
      // down) so that: (1) a recovered field is compared against the
      // fingerprint using its NEW value, not flagged as a conflict against
      // the invalid placeholder it replaces; and (2) a recovered model is
      // already in place if output also grows on this same snapshot, so that
      // block reprices with the correct family rather than `unknown`.
      if (existing.provisionalFields && existing.provisionalFields.size > 0) {
        let recovered = false
        if (existing.provisionalFields.has('model') && !entry.provisionalFields?.has('model')) {
          existing.modelRaw = entry.modelRaw
          existing.modelFamily = entry.modelFamily
          existing.provisionalFields.delete('model')
          recovered = true
        }
        const counterFields: Exclude<ProvisionalField, 'model'>[] = [
          'inputTokens',
          'cacheReadTokens',
          'cacheWrite5m',
          'cacheWrite1h',
          'cacheWriteFlat',
        ]
        for (const field of counterFields) {
          if (existing.provisionalFields.has(field) && !entry.provisionalFields?.has(field)) {
            existing[field] = entry[field]
            existing.provisionalFields.delete(field)
            recovered = true
          }
        }
        // Each field recovers independently, and `cacheWriteFlat` can recover
        // without `cacheWrite5m`/`cacheWrite1h` doing the same: a first
        // snapshot with an invalid flat counter but no `cache_creation`
        // object at all reports the tiers as a legitimate, valid absence
        // (0/0 — see the judgement call on `ResponseEntry.provisionalFields`),
        // so they are never provisional and stay first-seen even after the
        // flat counter is repaired by a later snapshot. The repriced total
        // then runs entirely through `cacheWriteUnknownTtl`'s 5-minute
        // fallback, because the tiers never explain any of it — understating
        // cost against the true rate whenever the write was actually
        // 1h-heavy. This is the correct consequence of the ruling ("a
        // validly-absent optional counter is never provisional"), not a bug;
        // see the "prices a recovered flat counter's remainder at the 5m
        // fallback" test for the number.
        if (existing.provisionalFields.size === 0) existing.provisionalFields = undefined
        // usageIncomplete is NOT cleared here — see its own comment: it is
        // sticky provenance that this response was reported badly at least
        // once, not a per-field error that recovering a field resolves.
        if (recovered) existing.costUsd = repriceFromRetainedFields(existing)
      }

      if (entry.outputTokens > existing.outputTokens) {
        existing.outputTokens = entry.outputTokens
        existing.costUsd = repriceFromRetainedFields(existing)
      }
      // Order-dependent by design, not by accident: an invalid observation
      // followed by a valid one for the same field was just copied onto
      // `existing` in the recovery block above, so the two fingerprints
      // agree and no conflict is raised — that arrival order is a repair,
      // not a disagreement between two measurements. The reverse order (a
      // bad snapshot arriving AFTER a good one) has nothing to recover —
      // `existing` already holds a valid first-seen value untouched by the
      // block above — so `entry`'s own invalid/coerced value still disagrees
      // with it here and correctly raises `usageConflict`. Billing is
      // identical either way (the invalid observation is never priced from,
      // recovered or not) and `usageIncomplete` is set in both orders, so
      // this asymmetry is cosmetic to provenance, not to cost.
      if (stableUsageFingerprint(existing) !== stableUsageFingerprint(entry)) {
        existing.usageConflict = true
      }
      // A shape flagged unpriceable in any one snapshot makes the merged
      // response unpriceable too — the flag never gets cleared by a later,
      // cleaner-looking snapshot. Note the asymmetry with usageConflict just
      // above: `iterations` is not part of stableUsageFingerprint, so a stray
      // multi-iteration provisional snapshot sets this sticky true without
      // ever registering as a conflict.
      if (entry.usageIncomplete) existing.usageIncomplete = true
    },
    entries(): ResponseEntry[] {
      return [...byResponseId.values()]
    },
    negativeCounters(): number {
      return negativeCounterResponseIds.size
    },
  }
}

/**
 * Read one transcript and return its billable responses, deduplicated.
 *
 * Re-ingesting a file replaces its entries wholesale rather than applying a
 * delta, so replay is idempotent by construction — which is what lets "just
 * re-parse it" serve as the recovery path for any inconsistency. A single file
 * costs ~2ms; the whole history ~1.1s.
 */
export async function ingestFile(
  filePath: string,
  source: SourceIdentity,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<IngestResult> {
  const accumulator = createResponseAccumulator(filePath, source, pricingTable)
  let malformedLines = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      accumulator.add(JSON.parse(trimmed) as RawRecord)
    } catch {
      malformedLines++
    }
  }

  return {
    entries: accumulator.entries(),
    malformedLines,
    negativeCounters: accumulator.negativeCounters(),
  }
}
