import { describe, it, expect } from 'vitest'
import { buildCompletenessBadge, buildProvenanceNote } from './completeness-badge'

const zero = {
  unpricedResponses: 0,
  incompleteUsageResponses: 0,
  responsesWithoutCompletionSignal: 0,
  reducedConfidenceResponses: 0,
  pricingModifierResponses: 0,
  serverToolRequests: 0,
}

/**
 * The shape the live corpus actually produces — 700 files, 32,271 responses,
 * measured. Both error-class counts are 0 (this is what `verify:accounting`
 * asserts on real history); `responsesWithoutCompletionSignal` is 8,429, or
 * 26% of every response ever recorded.
 *
 * Pinned as a named constant rather than inlined because it is the whole
 * argument for splitting the two classes apart: any rule that puts this shape
 * on the KPI badge puts it there for every real user, permanently.
 */
const MEASURED_REAL_HISTORY = {
  unpricedResponses: 0,
  incompleteUsageResponses: 0,
  responsesWithoutCompletionSignal: 8429,
  reducedConfidenceResponses: 0,
  // Task 17 probe: every real response reports `speed: standard`,
  // `inference_geo: not_available`, `service_tier: standard` and zero web
  // search/fetch requests, so neither attention clause fires.
  pricingModifierResponses: 0,
  serverToolRequests: 0,
}

describe('buildCompletenessBadge — error-class and estimate-gap clauses only', () => {
  it('returns undefined when all six counts are zero', () => {
    expect(buildCompletenessBadge(zero)).toBeUndefined()
  })

  /**
   * The regression this split exists to prevent, stated as a test.
   *
   * The badge is an always-visible pill on the Overview "Total Cost" card and
   * the Cache tab, inside a `lg:grid-cols-5` row. When it carried the
   * provenance clauses too it was present for every real user on every
   * render, because `responsesWithoutCompletionSignal` is non-zero on all
   * real history. A badge that never turns off stops being read as a signal,
   * which defeats the two error-class counts sharing the slot — the ones that
   * genuinely mean "look at this".
   *
   * So: on the measured real-history shape the badge must be ABSENT, and the
   * provenance must still be REACHABLE. Folding the provenance clauses back
   * into the badge fails the first half; deleting them fails the second.
   */
  it('is absent on the measured real-history shape, while the provenance stays reachable', () => {
    expect(buildCompletenessBadge(MEASURED_REAL_HISTORY)).toBeUndefined()
    expect(buildProvenanceNote(MEASURED_REAL_HISTORY)).toBe(
      '8,429 responses report output as the maximum observed, not a reported final count'
    )
  })

  it('reproduces the original unpricedResponses-only badge text unchanged', () => {
    expect(buildCompletenessBadge({ ...zero, unpricedResponses: 3 })).toBe(
      'Excludes 3 unpriced responses'
    )
    expect(buildCompletenessBadge({ ...zero, unpricedResponses: 1 })).toBe(
      'Excludes 1 unpriced response'
    )
  })

  it('adds an independent clause for incompleteUsageResponses without touching the others', () => {
    expect(buildCompletenessBadge({ ...zero, incompleteUsageResponses: 2 })).toBe(
      '2 responses partially observed (incomplete usage)'
    )
  })

  it('keeps both error-class categories as distinct clauses rather than collapsing them', () => {
    expect(
      buildCompletenessBadge({ ...zero, unpricedResponses: 1, incompleteUsageResponses: 2 })
    ).toBe('Excludes 1 unpriced response; 2 responses partially observed (incomplete usage)')
  })

  it('never puts a provenance clause on the badge, however large the count', () => {
    const badge = buildCompletenessBadge({
      ...zero,
      responsesWithoutCompletionSignal: 8429,
      reducedConfidenceResponses: 99,
    })
    expect(badge).toBeUndefined()
  })

  it('shows the error-class badge even when a provenance count is also present', () => {
    // The split must not make an error-class count conditional on anything —
    // a real problem is reported whether or not provenance is also in play.
    const counts = { ...MEASURED_REAL_HISTORY, unpricedResponses: 2 }
    expect(buildCompletenessBadge(counts)).toBe('Excludes 2 unpriced responses')
    expect(buildProvenanceNote(counts)).toContain('8,429 responses')
  })
})

/**
 * Task 17: the estimate prices every response at the list rate and never
 * prices web search/fetch requests. Those gaps are attention-class — the
 * number shown can differ from the real bill — so they share the badge, but
 * always AFTER the error-class clauses and never in place of them.
 */
describe('buildCompletenessBadge — estimate gaps', () => {
  it('appends the modifier and server-tool clauses after the error-class ones', () => {
    expect(
      buildCompletenessBadge({
        ...zero,
        unpricedResponses: 1,
        incompleteUsageResponses: 2,
        pricingModifierResponses: 3,
        serverToolRequests: 4,
      })
    ).toBe(
      'Excludes 1 unpriced response; ' +
        '2 responses partially observed (incomplete usage); ' +
        '3 responses used fast mode, regional inference or a non-standard service tier — not included in the estimate; ' +
        '4 web search/fetch requests — billed per request, not included'
    )
  })

  it('reports each gap on its own, singular and group-separated', () => {
    expect(buildCompletenessBadge({ ...zero, pricingModifierResponses: 1 })).toBe(
      '1 response used fast mode, regional inference or a non-standard service tier — not included in the estimate'
    )
    expect(buildCompletenessBadge({ ...zero, serverToolRequests: 1 })).toBe(
      '1 web search/fetch request — billed per request, not included'
    )
    expect(buildCompletenessBadge({ ...zero, serverToolRequests: 12345 })).toBe(
      '12,345 web search/fetch requests — billed per request, not included'
    )
  })

  it('keeps them off the provenance note', () => {
    expect(
      buildProvenanceNote({ ...zero, pricingModifierResponses: 3, serverToolRequests: 4 })
    ).toBeUndefined()
  })
})

describe('buildProvenanceNote — provenance-class only', () => {
  it('returns undefined when all six counts are zero', () => {
    expect(buildProvenanceNote(zero)).toBeUndefined()
  })

  it('carries the no-completion-signal clause in wording that does not read as an error', () => {
    const note = buildProvenanceNote({ ...zero, responsesWithoutCompletionSignal: 5 })
    expect(note).toBe(
      '5 responses report output as the maximum observed, not a reported final count'
    )
    expect(note).not.toMatch(/missing|error|problem|incomplete|untrustworthy/i)
  })

  it('carries the reduced-confidence-identity clause', () => {
    expect(buildProvenanceNote({ ...zero, reducedConfidenceResponses: 1 })).toBe(
      '1 response identified by record uuid (identity fell back, no message.id)'
    )
  })

  it('keeps the two provenance categories distinct rather than collapsing them', () => {
    expect(
      buildProvenanceNote({
        ...zero,
        responsesWithoutCompletionSignal: 3,
        reducedConfidenceResponses: 4,
      })
    ).toBe(
      '3 responses report output as the maximum observed, not a reported final count; ' +
        '4 responses identified by record uuid (identity fell back, no message.id)'
    )
  })

  it('never puts an error-class clause in the provenance note', () => {
    expect(
      buildProvenanceNote({ ...zero, unpricedResponses: 7, incompleteUsageResponses: 8 })
    ).toBeUndefined()
  })

  /**
   * The six counts are still six distinct facts across the two surfaces —
   * nothing was collapsed into a single "data problem" summary, and no count
   * lost its own wording in the move. Every one of them is reported by
   * exactly one of the two builders.
   */
  it('reports all six counts across the two builders, each exactly once', () => {
    const all = {
      unpricedResponses: 1,
      incompleteUsageResponses: 2,
      responsesWithoutCompletionSignal: 3,
      reducedConfidenceResponses: 4,
      pricingModifierResponses: 5,
      serverToolRequests: 6,
    }
    const combined = `${buildCompletenessBadge(all)}; ${buildProvenanceNote(all)}`
    expect(combined).toBe(
      'Excludes 1 unpriced response; ' +
        '2 responses partially observed (incomplete usage); ' +
        '5 responses used fast mode, regional inference or a non-standard service tier — not included in the estimate; ' +
        '6 web search/fetch requests — billed per request, not included; ' +
        '3 responses report output as the maximum observed, not a reported final count; ' +
        '4 responses identified by record uuid (identity fell back, no message.id)'
    )
  })
})
