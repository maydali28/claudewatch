/**
 * The six completeness counts `AnalyticsData` and `CacheAnalytics` both carry
 * (see their doc comments) are three kinds of fact, two of each, and they are
 * not all shown the same way.
 *
 * - `unpricedResponses` / `incompleteUsageResponses` are ERROR-class: data
 *   really is unpriced or only partially observed, and the number is 0 across
 *   measured history (`verify:accounting` asserts that). Something being
 *   non-zero here is news, so these go in the KPI card's inline badge, where
 *   they are impossible to miss.
 * - `responsesWithoutCompletionSignal` / `reducedConfidenceResponses` are
 *   PROVENANCE: every one of those responses was fully priced and counted,
 *   and the first of them stands at ~26% of all real responses (8,429 of
 *   32,271 measured). These go behind a hover affordance instead.
 * - `pricingModifierResponses` / `serverToolRequests` are ESTIMATE GAPS
 *   (attention-class): fully counted, but priced at the list rate or not
 *   priced at all, so the estimate leaves something out. 0 on all measured
 *   history (Task 17 probe), so they share the badge, after the error-class
 *   clauses.
 *
 * Why they were separated. The error and provenance classes used to be
 * joined into one string on the KPI badge. On real history that made the
 * badge unconditionally present — an 81-character pill beside a `text-2xl`
 * value in a one-fifth-width card, for every user, forever. A badge that
 * never turns off is not read as a signal; it is read as chrome, and the
 * reader stops seeing it. That is precisely what destroys the error-class
 * counts it was sharing the slot with: the two numbers that genuinely mean
 * "look at this" become invisible behind a number that always says the same
 * thing.
 *
 * This is the same prevalence trap the export layer already fixed once, where
 * a 28%-prevalence provenance condition was firing a missing-data lead
 * sentence on 22.5% of sessions. The resolution there and here is the same —
 * prevalence decides the PROMINENCE, never whether the fact is reported.
 *
 * Nothing is collapsed and nothing is deleted: all six counts keep their own
 * independent clause and their own wording, in the same vocabulary
 * `export-service.ts`'s `diagnosticsNote` and `session-details-panel.tsx`
 * use, so an export, the session panel and these two surfaces never describe
 * the same count in different terms. Only the slot changed.
 */
export interface CompletenessCounts {
  unpricedResponses: number
  incompleteUsageResponses: number
  responsesWithoutCompletionSignal: number
  reducedConfidenceResponses: number
  /** Estimate gap — see `buildCompletenessBadge`. */
  pricingModifierResponses: number
  /** Estimate gap, counted in requests rather than responses. */
  serverToolRequests: number
}

/** `N response`/`N responses` (or another noun), with the count group-separated. */
function plural(n: number, tail: string, noun = 'response'): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'} ${tail}`
}

/**
 * Error-class clauses, then estimate-gap clauses — the KPI card's inline badge.
 *
 * `undefined` when the error-class and estimate-gap counts are all zero,
 * which is the case on all measured history, so the badge is absent for a
 * real user unless something actually needs attention. Callers drop the
 * `badge` prop entirely then.
 *
 * The provenance counts are deliberately NOT considered here; they are
 * reported by `buildProvenanceNote` below and must stay reachable from the
 * same card. Folding them back in is the regression this split exists to
 * prevent — see this module's header.
 */
export function buildCompletenessBadge(counts: CompletenessCounts): string | undefined {
  const clauses: string[] = []

  // Unchanged from the original badge — this is the established pattern, and
  // the wording is kept byte-identical rather than re-styled.
  if (counts.unpricedResponses > 0) {
    const n = counts.unpricedResponses
    clauses.push(`Excludes ${n.toLocaleString()} unpriced response${n === 1 ? '' : 's'}`)
  }

  if (counts.incompleteUsageResponses > 0) {
    clauses.push(plural(counts.incompleteUsageResponses, 'partially observed (incomplete usage)'))
  }

  // Attention-class, and always AFTER the error-class clauses above: the
  // estimate prices every response at the list rate and never prices
  // per-request server tools, so these say what the figure leaves out. They
  // are 0 on all measured history, so they do not turn the badge into chrome.
  if (counts.pricingModifierResponses > 0) {
    clauses.push(
      plural(
        counts.pricingModifierResponses,
        'used fast mode, regional inference or a non-standard service tier — not included in the estimate'
      )
    )
  }

  if (counts.serverToolRequests > 0) {
    clauses.push(
      plural(
        counts.serverToolRequests,
        '— billed per request, not included',
        'web search/fetch request'
      )
    )
  }

  return clauses.length > 0 ? clauses.join('; ') : undefined
}

/**
 * Provenance-class clauses only — the KPI card's hover affordance.
 *
 * `undefined` when both provenance counts are zero, so the affordance is
 * absent rather than empty. The wording is byte-identical to what the badge
 * carried before the split: this moved where the text appears, not what it
 * says, and never reads as "something is wrong", because nothing is — every
 * response counted here was fully priced and fully counted.
 */
export function buildProvenanceNote(counts: CompletenessCounts): string | undefined {
  const clauses: string[] = []

  // Same fact as `export-service.ts`'s provenance clause and
  // `session-details-panel.tsx`'s wording — "the maximum observed, not a
  // reported final count" — never "missing" or "incomplete".
  if (counts.responsesWithoutCompletionSignal > 0) {
    clauses.push(
      plural(
        counts.responsesWithoutCompletionSignal,
        'report output as the maximum observed, not a reported final count'
      )
    )
  }

  // Tokens and cost are still counted; only the response's identity fell back
  // to the record uuid.
  if (counts.reducedConfidenceResponses > 0) {
    clauses.push(
      plural(
        counts.reducedConfidenceResponses,
        'identified by record uuid (identity fell back, no message.id)'
      )
    )
  }

  return clauses.length > 0 ? clauses.join('; ') : undefined
}
