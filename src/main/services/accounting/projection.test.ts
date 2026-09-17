import { describe, expect, it } from 'vitest'
import type { ResponseEntry } from './ledger'
import { createResponseAccumulator } from './ledger'
import type { RawRecord } from '@shared/types/session'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'
import { UNDATED_DAY } from '@shared/utils/date-ranges'
import { projectUsage } from './projection'

let seq = 0

function entry(over: Partial<ResponseEntry> = {}): ResponseEntry {
  seq++
  return {
    responseId: `msg_${seq}`,
    filePath: '/p/sess.jsonl',
    kind: 'parent',
    projectId: 'proj',
    sessionId: 'sess',
    tsUtc: '2026-09-10T10:00:00.000Z',
    dayLocal: '2026-09-10',
    modelRaw: 'claude-opus-5',
    modelFamily: 'opus-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheWriteFlat: 0,
    snapshotCount: 1,
    usageConflict: false,
    usageIncomplete: false,
    hasCompletionSignal: true,
    reducedConfidenceId: false,
    costUsd: 0,
    pricingRevision: 2,
    ...over,
  }
}

/**
 * The parent summary previously rolled up subagent input, output, cost and
 * cache writes but silently omitted subagent cache reads, so a session's totals
 * could not reconcile with its own model breakdown. On one real session the gap
 * was exactly 101,950,511 tokens.
 */
describe('projectUsage — parent and child scopes', () => {
  it('rolls up every category from subagents, cache reads included', () => {
    const p = projectUsage([
      entry({ kind: 'parent', inputTokens: 10, cacheReadTokens: 100 }),
      entry({ kind: 'subagent', agentId: 'a1', inputTokens: 5, cacheReadTokens: 500 }),
    ])

    expect(p.parent.cacheReadTokens).toBe(100)
    expect(p.combined.cacheReadTokens).toBe(600)
    expect(p.combined.inputTokens).toBe(15)
  })

  it('reconciles combined totals with the model breakdown', () => {
    const p = projectUsage([
      entry({ kind: 'parent', modelRaw: 'claude-opus-5', cacheReadTokens: 100 }),
      entry({
        kind: 'subagent',
        modelRaw: 'claude-haiku-4-5',
        modelFamily: 'haiku-4-5',
        cacheReadTokens: 500,
      }),
    ])

    const fromBreakdown = p.modelBreakdown.reduce((s, m) => s + m.cacheReadTokens, 0)
    expect(fromBreakdown).toBe(p.combined.cacheReadTokens)
  })

  it('keeps parent-only totals free of subagent usage', () => {
    const p = projectUsage([
      entry({ kind: 'parent', outputTokens: 7 }),
      entry({ kind: 'subagent', outputTokens: 900 }),
    ])

    expect(p.parent.outputTokens).toBe(7)
    expect(p.combined.outputTokens).toBe(907)
  })
})

/**
 * The badge showed whichever model had accumulated the most turns, so switching
 * model mid-session kept displaying the old one. Latest and dominant are now
 * distinct, and a subagent never determines the parent's badge.
 */
describe('projectUsage — model identity', () => {
  it('reports the latest parent model by response time', () => {
    const p = projectUsage([
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T09:30:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T10:00:00.000Z', modelRaw: 'claude-sonnet-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-sonnet-5')
  })

  it('reports the dominant parent model by response count', () => {
    const p = projectUsage([
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T09:30:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T10:00:00.000Z', modelRaw: 'claude-sonnet-5' }),
    ])

    expect(p.dominantParentModel).toBe('claude-opus-5')
  })

  it('does not let a subagent model become the parent badge', () => {
    const p = projectUsage([
      entry({ kind: 'parent', tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ kind: 'subagent', tsUtc: '2026-09-10T23:00:00.000Z', modelRaw: 'claude-haiku-4-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-opus-5')
  })

  it('lists every model used, parent and child', () => {
    const p = projectUsage([
      entry({ kind: 'parent', modelRaw: 'claude-opus-5' }),
      entry({ kind: 'subagent', modelRaw: 'claude-haiku-4-5' }),
    ])

    expect([...p.modelsUsed].sort()).toEqual(['claude-haiku-4-5', 'claude-opus-5'])
  })

  it('picks the chronologically later response even when its offset sorts it earlier as text', () => {
    // '+02:00' is 2026-09-13T22:30:00Z — earlier than the Opus response below —
    // but as a raw string it sorts after 'Z', which is exactly what a lexical
    // comparison of the timestamps would get wrong.
    const p = projectUsage([
      entry({ tsUtc: '2026-09-14T00:30:00+02:00', modelRaw: 'claude-sonnet-5' }),
      entry({ tsUtc: '2026-09-13T23:00:00Z', modelRaw: 'claude-opus-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-opus-5')
  })

  it('keeps the earlier-seen response on an exact timestamp tie', () => {
    const p = projectUsage([
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-sonnet-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-opus-5')
  })

  it('does not let an unparseable timestamp win the badge', () => {
    const p = projectUsage([
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: 'not-a-timestamp', modelRaw: 'claude-sonnet-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-opus-5')
  })

  it('does not let an unparseable timestamp stand in as the first latest response', () => {
    const p = projectUsage([entry({ tsUtc: 'garbage', modelRaw: 'claude-sonnet-5' })])

    expect(p.latestParentModel).toBeUndefined()
  })

  it('still orders correctly across an all-Z corpus (regression pin)', () => {
    const p = projectUsage([
      entry({ tsUtc: '2026-09-10T09:00:00.000Z', modelRaw: 'claude-opus-5' }),
      entry({ tsUtc: '2026-09-10T09:30:00.000Z', modelRaw: 'claude-sonnet-5' }),
      entry({ tsUtc: '2026-09-10T09:15:00.000Z', modelRaw: 'claude-haiku-4-5' }),
    ])

    expect(p.latestParentModel).toBe('claude-sonnet-5')
  })
})

/**
 * Analytics attributed a session's entire history to its last active day, so
 * resuming yesterday's session today moved yesterday's tokens into today.
 */
describe('projectUsage — day attribution', () => {
  it('buckets each response on its own day', () => {
    const p = projectUsage([
      entry({ dayLocal: '2026-09-08', inputTokens: 100, outputTokens: 10 }),
      entry({ dayLocal: '2026-09-08', inputTokens: 200, outputTokens: 20 }),
      entry({ dayLocal: '2026-09-09', inputTokens: 30, outputTokens: 3 }),
    ])

    expect(p.byDay.map((d) => d.day)).toEqual(['2026-09-08', '2026-09-09'])
    expect(p.byDay[0].inputTokens + p.byDay[0].outputTokens).toBe(330)
    expect(p.byDay[1].inputTokens + p.byDay[1].outputTokens).toBe(33)
  })

  it('attributes a subagent to its own day, not the parent’s', () => {
    const p = projectUsage([
      entry({ kind: 'parent', dayLocal: '2026-09-08', outputTokens: 1 }),
      entry({ kind: 'subagent', dayLocal: '2026-09-09', outputTokens: 5 }),
    ])

    expect(p.byDay.map((d) => d.day)).toEqual(['2026-09-08', '2026-09-09'])
  })

  it('records which models were used on each day', () => {
    const p = projectUsage([
      entry({ dayLocal: '2026-09-08', modelRaw: 'claude-opus-5', modelFamily: 'opus-5' }),
      entry({ dayLocal: '2026-09-09', modelRaw: 'claude-sonnet-5', modelFamily: 'sonnet-5' }),
    ])

    expect(p.byDay[0].families).toEqual(['opus-5'])
    expect(p.byDay[1].families).toEqual(['sonnet-5'])
  })

  /**
   * `dayLocal` is now the ledger's own `toDayKeyOrUndated` output, so a
   * response whose raw timestamp was unparsable arrives here already carrying
   * `UNDATED_DAY` rather than a `NaN-NaN-NaN` string. This proves the
   * projection layer buckets that sentinel like any other day key — one
   * `Map` entry, not scattered across a garbage per-timestamp key — with no
   * special-casing needed here.
   */
  it('projects a response with an unparsable timestamp into the undated day', () => {
    const p = projectUsage([
      entry({ dayLocal: '2026-09-08', outputTokens: 1 }),
      entry({ dayLocal: UNDATED_DAY, outputTokens: 1 }),
    ])

    expect(p.byDay.some((d) => d.day.includes('NaN'))).toBe(false)
    expect(p.byDay.find((d) => d.day === UNDATED_DAY)?.responseCount).toBe(1)
  })
})

/**
 * An unrecognised model must keep its tokens visible while staying out of a
 * cost total that is presented as complete.
 */
describe('projectUsage — unpriced responses', () => {
  it('counts unpriced tokens but excludes them from cost', () => {
    const p = projectUsage([
      entry({ modelFamily: 'opus-5', outputTokens: 100, costUsd: 2.5 }),
      entry({
        modelRaw: 'claude-future-9',
        modelFamily: 'unknown',
        outputTokens: 40,
        costUsd: null,
      }),
    ])

    expect(p.combined.outputTokens).toBe(140)
    expect(p.combined.estimatedCost).toBeCloseTo(2.5, 10)
    expect(p.combined.unpricedResponses).toBe(1)
  })

  it('keeps unrecognised models visible in the breakdown', () => {
    const p = projectUsage([
      entry({
        modelRaw: 'claude-future-9',
        modelFamily: 'unknown',
        outputTokens: 40,
        costUsd: null,
      }),
    ])

    expect(p.modelBreakdown.map((m) => m.model)).toEqual(['claude-future-9'])
    expect(p.modelBreakdown[0].estimatedCost).toBeNull()
  })
})

/**
 * The day total already falls back to the flat counter when the tiers are
 * absent (see `add()` in projection.ts), but the per-model rows had no
 * equivalent fallback — an unsplit write reported zero tier tokens and zero
 * tier cost against a non-zero day total. `cacheWriteUnknownTtl` carries the
 * remainder the tiers do not explain so the model breakdown reconciles with
 * the day total again.
 */
describe('projectUsage — unsplit cache writes', () => {
  it('keeps an unsplit cache write visible in the model breakdown', () => {
    const p = projectUsage([entry({ cacheWriteFlat: 300, cacheWrite5m: 0, cacheWrite1h: 0 })])

    expect(p.combined.cacheWriteTotal).toBe(300)
    expect(p.modelBreakdown[0].cacheWriteUnknownTtl).toBe(300)
    const tiers = p.modelBreakdown[0].cacheWrite5m + p.modelBreakdown[0].cacheWrite1h
    expect(tiers + p.modelBreakdown[0].cacheWriteUnknownTtl).toBe(300)
  })

  it('reports zero unknown TTL when a write is fully split across tiers', () => {
    const p = projectUsage([entry({ cacheWriteFlat: 300, cacheWrite5m: 100, cacheWrite1h: 200 })])

    expect(p.modelBreakdown[0].cacheWriteUnknownTtl).toBe(0)
  })

  it('carries only the unexplained remainder when a write is partially split', () => {
    const p = projectUsage([entry({ cacheWriteFlat: 300, cacheWrite5m: 100, cacheWrite1h: 0 })])

    expect(p.modelBreakdown[0].cacheWriteUnknownTtl).toBe(200)
  })
})

/**
 * Task 4: the reproduction that found the defect. `add()` used to sum the raw
 * flat counter unconditionally (`totals.cacheWriteTotal += e.cacheWriteFlat`),
 * so a response reporting flat = 40 but tiers summing to 100 showed 40 tokens
 * here while `ledger.ts` priced 100 of them — one response, two quantities,
 * and `incompleteUsageResponses` was the only thing that could have caught it.
 * `effectiveCacheWriteTotal` makes the tier sum win when it is the larger of
 * the two, matching what the ledger already priced.
 */
describe('projectUsage — cache-write tiers larger than the flat counter', () => {
  it('prices and counts the same write volume when tiers exceed the flat total', () => {
    const p = projectUsage([
      entry({ cacheWriteFlat: 40, cacheWrite5m: 100, cacheWrite1h: 0, usageIncomplete: true }),
    ])

    expect(p.combined.cacheWriteTotal).toBe(100)
    expect(p.combined.cacheWrite5m).toBe(100)
    expect(p.combined.cacheWriteUnknownTtl).toBe(0)
    expect(p.modelBreakdown[0].cacheWriteUnknownTtl).toBe(0)
  })

  it('flags the tier/flat mismatch as incomplete usage', () => {
    const p = projectUsage([
      entry({ cacheWriteFlat: 40, cacheWrite5m: 100, cacheWrite1h: 0, usageIncomplete: true }),
    ])

    expect(p.combined.incompleteUsageResponses).toBe(1)
  })

  it('keeps the flat total authoritative when it exceeds the tiers', () => {
    // The already-fixed case, guarded against regressing: flat = 100, 5m = 40.
    const p = projectUsage([entry({ cacheWriteFlat: 100, cacheWrite5m: 40, cacheWrite1h: 0 })])

    expect(p.combined.cacheWriteTotal).toBe(100)
    expect(p.combined.cacheWriteUnknownTtl).toBe(60)
  })
})

describe('projectUsage — empty input', () => {
  it('produces zeroed totals rather than throwing', () => {
    const p = projectUsage([])

    expect(p.combined.responseCount).toBe(0)
    expect(p.combined.estimatedCost).toBe(0)
    expect(p.latestParentModel).toBeUndefined()
    expect(p.byDay).toEqual([])
  })
})

/**
 * `ResponseEntry` already captures `thinkingTokens`, `effortRecorded`,
 * `serviceTier`, `speed`, `inferenceGeo` and `usageConflict` (see ledger.ts),
 * but until now none of them reached the projection — this reproduces that
 * gap and locks the fix in place.
 */
describe('projectUsage — captured response metadata reaches the projection', () => {
  it('carries reported thinking tokens and recorded effort without touching output', () => {
    const p = projectUsage([
      entry({
        outputTokens: 1000,
        thinkingTokens: 400,
        effortRecorded: 'high',
        serviceTier: 'standard',
      }),
    ])

    expect(p.combined.thinkingTokens).toBe(400)
    // The one thing this task must not get wrong: thinkingTokens is a SUBSET
    // of outputTokens, reported for display, never a quantity added to it.
    // A regression here would silently double-count real usage.
    expect(p.combined.outputTokens).toBe(1000)
    expect(p.recordedEffortDistribution).toEqual({ high: 1 })
    expect(p.serviceTiers).toEqual(['standard'])
  })

  it('never lets thinkingTokens inflate outputTokens across several responses', () => {
    const p = projectUsage([
      entry({ outputTokens: 100, thinkingTokens: 90 }),
      entry({ outputTokens: 50, thinkingTokens: 50 }),
    ])

    expect(p.combined.outputTokens).toBe(150)
    expect(p.combined.thinkingTokens).toBe(140)
  })

  it('collects distinct service tier, speed and inference-geo values without duplicates', () => {
    const p = projectUsage([
      entry({ serviceTier: 'standard', speed: 'fast', inferenceGeo: 'us' }),
      entry({ serviceTier: 'standard', speed: 'fast', inferenceGeo: 'eu' }),
      entry({ serviceTier: 'priority', speed: 'slow', inferenceGeo: 'us' }),
    ])

    expect(p.serviceTiers).toEqual(['priority', 'standard'])
    expect(p.speeds).toEqual(['fast', 'slow'])
    expect(p.inferenceGeos).toEqual(['eu', 'us'])
  })

  it('leaves recordedEffortDistribution and serviceTiers empty when nothing reported them', () => {
    const p = projectUsage([entry({})])

    expect(p.recordedEffortDistribution).toEqual({})
    expect(p.serviceTiers).toEqual([])
  })

  it('surfaces a merge disagreement as conflictCount rather than leaving it internal', () => {
    const p = projectUsage([entry({ usageConflict: true }), entry({ usageConflict: false })])

    expect(p.conflictCount).toBe(1)
  })

  /**
   * `session-details-panel.tsx` renders "Reported thinking" beside whichever
   * output figure shares its scope — parent-only output when there are no
   * subagents, the combined "Total output" figure when there are — precisely
   * so the displayed thinking figure can never exceed the output total it is
   * labelled a subset of. That component has no test harness yet, so this
   * pins the projection-level invariant the UI depends on instead: combined
   * thinking never exceeds combined output. The first assertion shows why
   * scope-matching is load-bearing and not just cosmetic — combined thinking
   * CAN exceed the *parent-only* output total once a subagent contributes
   * enough thinking of its own, which is exactly the mismatch a prior review
   * caught when this row was paired with the wrong-scoped figure.
   */
  it('keeps the combined thinking total from exceeding the combined output total', () => {
    const p = projectUsage([
      entry({ kind: 'parent', outputTokens: 50, thinkingTokens: 10 }),
      entry({ kind: 'subagent', outputTokens: 200, thinkingTokens: 150 }),
    ])

    // Pairing combined thinking with the PARENT's output total would show an
    // impossible "subset" larger than the whole it's supposedly part of.
    expect(p.combined.thinkingTokens).toBeGreaterThan(p.parent.outputTokens)
    // At matching (combined-to-combined) scope, the subset relationship holds.
    expect(p.combined.thinkingTokens).toBeLessThanOrEqual(p.combined.outputTokens)
  })

  /**
   * Claude Code writes one record per content block of a response, every one
   * repeating the same `message.usage` (see ledger.ts's module doc). Feeding
   * the ACCUMULATOR two records of one response — with thinking tokens that
   * would sum to more than the final reported value — and only then reading
   * its single merged entry through `projectUsage` proves this is attributed
   * once per RESPONSE, not once per record. The previous task shipped a
   * diagnostic that got exactly this wrong.
   */
  it('attributes a multi-record response once, not once per record', () => {
    const acc = createResponseAccumulator(
      '/p/sess.jsonl',
      { kind: 'parent', projectId: 'proj', sessionId: 'sess' },
      ANTHROPIC_PRICING
    )
    const record = (uuid: string, output: number, thinking: number): RawRecord =>
      ({
        type: 'assistant',
        uuid,
        timestamp: '2026-09-10T10:00:00.000Z',
        message: {
          id: 'msg_multi',
          model: 'claude-opus-5',
          usage: {
            input_tokens: 10,
            output_tokens: output,
            output_tokens_details: { thinking_tokens: thinking },
            service_tier: 'standard',
          },
        },
        effort: 'high',
      }) as unknown as RawRecord

    // A provisional block-split record, then the completed one — the same
    // streaming shape that made summing per record overstate real usage.
    acc.add(record('r1', 20, 20))
    acc.add(record('r2', 50, 40))

    expect(acc.entries().length).toBe(1)

    const p = projectUsage(acc.entries())

    // 40, the final snapshot's figure — not 60, the sum across both records.
    expect(p.combined.thinkingTokens).toBe(40)
    expect(p.combined.outputTokens).toBe(50)
    expect(p.recordedEffortDistribution).toEqual({ high: 1 })
    expect(p.serviceTiers).toEqual(['standard'])
  })
})

/**
 * Task 5: provenance counts must roll up like every other per-response flag
 * in this module — one vote per response, deduplicated the same as
 * `responseCount`, and independent of `incompleteUsageResponses` (a
 * reduced-confidence id or a response without a completion signal is still fully priced).
 */
describe('projectUsage — provenance counts', () => {
  it('counts responses whose id fell back to the record uuid', () => {
    const p = projectUsage([
      entry({ reducedConfidenceId: true }),
      entry({ reducedConfidenceId: false }),
    ])

    expect(p.combined.reducedConfidenceResponses).toBe(1)
    expect(p.combined.responseCount).toBe(2)
  })

  it('counts responses with no completion signal on any snapshot', () => {
    const p = projectUsage([
      entry({ hasCompletionSignal: false }),
      entry({ hasCompletionSignal: true }),
    ])

    expect(p.combined.responsesWithoutCompletionSignal).toBe(1)
  })

  it('does not treat a reduced-confidence or response-without-completion-signal response as usage-incomplete', () => {
    const p = projectUsage([
      entry({ reducedConfidenceId: true, hasCompletionSignal: false, usageIncomplete: false }),
    ])

    expect(p.combined.incompleteUsageResponses).toBe(0)
  })
})

/**
 * The tests above pass already-deduplicated `ResponseEntry` objects straight
 * to `projectUsage`, so they can never catch a provenance counter that was
 * wired up per RECORD instead of per RESPONSE — the exact defect class an
 * earlier task on this branch shipped and had to fix in a later round (see
 * the "attributes a multi-record response once" test above). These go
 * through the real accumulator `ingestFile` itself uses, so a per-record
 * regression in `toEntry`/the merge would fail here even though every
 * hand-built-entry test above stays green.
 */
describe('projectUsage — provenance counts through the full record pipeline', () => {
  const PARENT = { kind: 'parent' as const, projectId: 'proj', sessionId: 'sess' }

  it('counts a multi-record response-without-completion-signal response once, not once per content-block record', () => {
    const acc = createResponseAccumulator('/p/sess.jsonl', PARENT, ANTHROPIC_PRICING)
    // Three content-block records of ONE response, none ever carrying a
    // `stop_reason` — the shape that made an earlier diagnostic on this
    // branch count per record instead of per response.
    const record = (uuid: string, output: number): RawRecord =>
      ({
        type: 'assistant',
        uuid,
        timestamp: '2026-09-10T10:00:00.000Z',
        message: {
          id: 'msg_no_completion_signal',
          model: 'claude-opus-5',
          usage: { input_tokens: 10, output_tokens: output },
        },
      }) as unknown as RawRecord

    acc.add(record('r1', 5))
    acc.add(record('r2', 5))
    acc.add(record('r3', 20))

    expect(acc.entries()).toHaveLength(1)

    const p = projectUsage(acc.entries())

    expect(p.combined.responsesWithoutCompletionSignal).toBe(1)
    expect(p.combined.responseCount).toBe(1)
  })

  /**
   * The discriminating fixture: two id-less records with DIFFERENT record
   * uuids are two genuinely distinct responses (each keys off its own uuid),
   * not one response split across two records — so they must both count
   * toward `reducedConfidenceResponses`. Mixed into the SAME file is a third
   * response that DOES carry a `message.id`, split across two content-block
   * records. A per-record counter would report 4 (every record); a counter
   * that conflated "no id" with "any multi-record response" would report 3
   * (every response) or fail to tell the id-bearing response apart. Only a
   * counter that is both per-RESPONSE and keyed on the id-fallback,
   * specifically, lands on the correct answer: 2.
   */
  it('counts reduced-confidence ids per response, discriminating from a mixed-in multi-record id-bearing response', () => {
    const acc = createResponseAccumulator('/p/sess.jsonl', PARENT, ANTHROPIC_PRICING)
    const idless = (uuid: string): RawRecord =>
      ({
        type: 'assistant',
        uuid,
        timestamp: '2026-09-10T10:00:00.000Z',
        // No `message.id` at all — falls back to `uuid:<uuid>`.
        message: {
          model: 'claude-opus-5',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }) as unknown as RawRecord
    const idBearing = (uuid: string, output: number): RawRecord =>
      ({
        type: 'assistant',
        uuid,
        timestamp: '2026-09-10T10:00:00.000Z',
        message: {
          id: 'msg_shared',
          model: 'claude-opus-5',
          usage: { input_tokens: 10, output_tokens: output },
        },
      }) as unknown as RawRecord

    acc.add(idless('u1'))
    acc.add(idless('u2'))
    acc.add(idBearing('c1', 20))
    acc.add(idBearing('c2', 50))

    // Four records, three responses: u1, u2, and the merged msg_shared pair.
    expect(acc.entries()).toHaveLength(3)

    const p = projectUsage(acc.entries())

    expect(p.combined.responseCount).toBe(3)
    // Exactly the two id-less responses — not 4 (total records) and not 3
    // (total responses, which would wrongly implicate msg_shared too).
    expect(p.combined.reducedConfidenceResponses).toBe(2)
  })
})

/**
 * Task 17: pricing modifiers and server-tool requests are counted, never
 * priced. The projection must report both without any token or cost figure
 * moving — the same entries with the counts stripped must project to the
 * same totals.
 */
describe('projectUsage — pricing modifiers and server tool requests', () => {
  it('counts pricingModifierResponses and serverToolRequests without changing any token or cost total', () => {
    const shape = [
      { kind: 'parent' as const, speed: 'fast', serverToolRequests: 2 },
      { kind: 'parent' as const, inferenceGeo: 'us' },
      { kind: 'subagent' as const, agentId: 'a1', serviceTier: 'priority', serverToolRequests: 3 },
      // Real history's shape: no modifier, zero requests.
      {
        kind: 'parent' as const,
        speed: 'standard',
        inferenceGeo: 'not_available',
        serviceTier: 'standard',
        serverToolRequests: 0,
      },
      { kind: 'subagent' as const, agentId: 'a1', dayLocal: '2026-09-11' },
    ]
    const withCounts = shape.map((over, i) =>
      entry({
        responseId: `mod_${i}`,
        inputTokens: 10 + i,
        outputTokens: 20 + i,
        cacheReadTokens: 30 + i,
        cacheWrite5m: 4,
        cacheWriteFlat: 4,
        costUsd: 0.25 * (i + 1),
        ...over,
      })
    )
    const stripped = withCounts.map((e) => ({
      ...e,
      speed: undefined,
      inferenceGeo: undefined,
      serviceTier: undefined,
      serverToolRequests: undefined,
    }))

    const p = projectUsage(withCounts)
    const baseline = projectUsage(stripped)

    expect(p.combined.pricingModifierResponses).toBe(3)
    expect(p.combined.serverToolRequests).toBe(5)
    expect(p.parent.pricingModifierResponses).toBe(2)
    expect(p.parent.serverToolRequests).toBe(2)
    const day10 = p.byDay.find((d) => d.day === '2026-09-10')!
    expect(day10.pricingModifierResponses).toBe(3)
    expect(day10.serverToolRequests).toBe(5)
    expect(p.byDay.find((d) => d.day === '2026-09-11')!.pricingModifierResponses).toBe(0)

    expect(baseline.combined.pricingModifierResponses).toBe(0)
    expect(baseline.combined.serverToolRequests).toBe(0)
    const strip = (t: typeof p.combined) => ({
      ...t,
      pricingModifierResponses: 0,
      serverToolRequests: 0,
    })
    expect(strip(p.combined)).toEqual(strip(baseline.combined))
    expect(strip(p.parent)).toEqual(strip(baseline.parent))
    expect(p.modelBreakdown).toEqual(baseline.modelBreakdown)
    expect(p.byDay.map(strip)).toEqual(baseline.byDay.map(strip))
  })
})
