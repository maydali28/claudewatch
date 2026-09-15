import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { SessionSummary } from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'

// electron-log's initialize() needs an Electron main-process runtime; under
// vitest's pool, `isMainThread` reads true even though there is no Electron
// here, so the real logger throws at import time (see autostart.test.ts).
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { configureMetadataCacheDir, getCachedSummary, setCachedSummary } from './metadata-cache'
import { pricingFingerprint } from './pricing-engine'

// Minimal stand-in — the cache stores whatever it's handed and never
// inspects the shape, so only identity (not full SessionSummary conformance)
// matters for these tests.
function fakeSummary(id: string): SessionSummary {
  return { id } as unknown as SessionSummary
}

// Used by every test that isn't specifically exercising pricing-fingerprint
// or timezone behaviour — fixed, valid values so those tests read exactly as
// they did before pricing/timezone awareness existed.
const FP = pricingFingerprint(ANTHROPIC_PRICING)
const TZ = 'America/New_York'

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-cache-'))
  configureMetadataCacheDir(dir)
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

// The module keeps a single in-memory `entries` map for its whole lifetime
// (there is no reset between tests), keyed only by file path — mtime/size/
// childFingerprint/pricingFingerprint/timezone are validity checks on read,
// not part of the key. Each test below therefore uses its own file path so
// entries never collide.

describe('getCachedSummary / setCachedSummary', () => {
  it('misses the cache when only a subagent transcript changed', () => {
    const parentPath = '/fake/project/misses-on-child-change.jsonl'
    const summary = fakeSummary('parent-session')
    setCachedSummary(parentPath, 1000, 500, 'child-fp-a', FP, TZ, summary)

    expect(getCachedSummary(parentPath, 1000, 500, 'child-fp-a', FP, TZ)).toBeDefined()
    expect(getCachedSummary(parentPath, 1000, 500, 'child-fp-b', FP, TZ)).toBeUndefined()
  })

  it('hits the cache when the parent fingerprint and child fingerprint both match', () => {
    const parentPath = '/fake/project/hits-on-match.jsonl'
    const summary = fakeSummary('parent-session')
    setCachedSummary(parentPath, 1000, 500, 'child-fp-a', FP, TZ, summary)

    expect(getCachedSummary(parentPath, 1000, 500, 'child-fp-a', FP, TZ)).toEqual(summary)
  })

  it('caches normally for a session with no subagents (empty-string fingerprint)', () => {
    const parentPath = '/fake/project/no-subagents.jsonl'
    const summary = fakeSummary('no-subagents-session')
    setCachedSummary(parentPath, 2000, 750, '', FP, TZ, summary)

    expect(getCachedSummary(parentPath, 2000, 750, '', FP, TZ)).toEqual(summary)
    // A later subagent write moving the fingerprint off '' must still miss —
    // otherwise a session that starts without subagents and later gains one
    // would keep serving the pre-subagent total.
    expect(getCachedSummary(parentPath, 2000, 750, 'new-child-fp', FP, TZ)).toBeUndefined()
  })

  it('still misses on a plain mtime/size change, independent of the child fingerprint', () => {
    const parentPath = '/fake/project/parent-changed.jsonl'
    const summary = fakeSummary('parent-session')
    setCachedSummary(parentPath, 1000, 500, 'child-fp-a', FP, TZ, summary)

    expect(getCachedSummary(parentPath, 1001, 500, 'child-fp-a', FP, TZ)).toBeUndefined()
  })
})

// `pricingFingerprint` stamps the whole cache FILE, not individual entries —
// so unlike the tests above (each on their own file path to avoid colliding
// in the module's single `entries` map), these share the effect of
// discarding the entire in-memory cache and must run in the sequence below.
describe('pricing fingerprint invalidation', () => {
  it('discards cached summaries when an override changes a rate', () => {
    const parentPath = '/fake/project/pricing-override-changes-rate.jsonl'
    const summary = fakeSummary('priced-session')

    setCachedSummary(parentPath, 1000, 500, '', FP, TZ, summary)
    expect(getCachedSummary(parentPath, 1000, 500, '', FP, TZ)).toEqual(summary)

    const overridden: Record<ModelFamily, ModelPricing> = {
      ...ANTHROPIC_PRICING,
      'opus-5': { ...ANTHROPIC_PRICING['opus-5'], input: 99 },
    }
    const overriddenFp = pricingFingerprint(overridden)

    // Same file path/mtime/size/childFingerprint as the write above — the
    // only thing that changed is the active pricing table, so a cache that
    // ignored pricing would still return the stale summary here.
    expect(getCachedSummary(parentPath, 1000, 500, '', overriddenFp, TZ)).toBeUndefined()
  })

  it('discards the cache when the override touches a different family entirely', () => {
    const parentPath = '/fake/project/pricing-override-other-family.jsonl'
    const summary = fakeSummary('priced-session-2')

    setCachedSummary(parentPath, 2000, 900, '', FP, TZ, summary)
    expect(getCachedSummary(parentPath, 2000, 900, '', FP, TZ)).toEqual(summary)

    // The overridden family (haiku-3) never appears in this session's own
    // entry — proving the fingerprint covers the whole table, not just the
    // families a given summary happens to use.
    const overridden: Record<ModelFamily, ModelPricing> = {
      ...ANTHROPIC_PRICING,
      'haiku-3': { ...ANTHROPIC_PRICING['haiku-3'], output: 1234 },
    }
    const overriddenFp = pricingFingerprint(overridden)

    expect(getCachedSummary(parentPath, 2000, 900, '', overriddenFp, TZ)).toBeUndefined()
  })

  it('keeps the cache hit when the same rates are re-saved (stable, not merely changing)', () => {
    const parentPath = '/fake/project/pricing-resaved-identical.jsonl'
    const summary = fakeSummary('priced-session-3')

    setCachedSummary(parentPath, 3000, 111, '', FP, TZ, summary)
    expect(getCachedSummary(parentPath, 3000, 111, '', FP, TZ)).toEqual(summary)

    // Re-derive the fingerprint from a fresh shallow clone with identical
    // values — a naive "changes every time" digest (e.g. one seeded with
    // Date.now() or object identity) would break this.
    const sameRatesAgain: Record<ModelFamily, ModelPricing> = { ...ANTHROPIC_PRICING }
    const sameFp = pricingFingerprint(sameRatesAgain)

    expect(getCachedSummary(parentPath, 3000, 111, '', sameFp, TZ)).toEqual(summary)
  })
})

// The reporting timezone stamps the whole cache FILE too, exactly like
// `pricingFingerprint` above — `dayLocal` keys on every cached summary are
// calendar days computed in whatever zone was active when they were parsed
// (see `toDateKey` in `shared/utils/date-ranges.ts`). Flying to another
// timezone and reopening the app must discard those summaries rather than
// mix day boundaries from two zones into one cached history.
describe('timezone invalidation', () => {
  it('discards cached summaries when the reporting timezone changed', () => {
    const parentPath = '/fake/project/timezone-changed.jsonl'
    const summary = fakeSummary('tz-session')

    setCachedSummary(parentPath, 1000, 500, '', FP, 'Europe/Berlin', summary)
    expect(getCachedSummary(parentPath, 1000, 500, '', FP, 'Europe/Berlin')).toEqual(summary)

    // Same file/mtime/size/childFingerprint/pricing table — only the
    // reporting zone changed (e.g. the machine flew from Berlin to Tokyo).
    expect(getCachedSummary(parentPath, 1000, 500, '', FP, 'Asia/Tokyo')).toBeUndefined()
  })

  it('keeps the cache hit when the reporting timezone is unchanged', () => {
    const parentPath = '/fake/project/timezone-unchanged.jsonl'
    const summary = fakeSummary('tz-session-2')

    setCachedSummary(parentPath, 2000, 900, '', FP, 'Europe/Berlin', summary)

    expect(getCachedSummary(parentPath, 2000, 900, '', FP, 'Europe/Berlin')).toEqual(summary)
  })
})

// Regression test for Finding 1 of the round-1 review: the first
// implementation tracked the active pricing fingerprint as module-level
// state (`configureMetadataCachePricing`), set once per request. The worker
// does not serialize requests (see worker-entry.ts / worker-client.ts), so a
// second request for a different table landing mid-flight could overwrite
// that shared state and cause the first request's later cache calls to be
// silently validated, and persisted, against the WRONG fingerprint. Passing
// the fingerprint as an explicit argument (this file's current design)
// closes that hole structurally — this test proves it under an interleaving
// a purely sequential test cannot exercise.
describe('concurrent requests priced against different tables', () => {
  it("never returns one table's entry as a hit under another table's fingerprint", async () => {
    const pathA = '/fake/project/interleave-a.jsonl'
    const pathB = '/fake/project/interleave-b.jsonl'
    const summaryA = fakeSummary('interleave-a')
    const summaryB = fakeSummary('interleave-b')
    const fpA = pricingFingerprint(ANTHROPIC_PRICING)
    const overriddenTable: Record<ModelFamily, ModelPricing> = {
      ...ANTHROPIC_PRICING,
      'opus-5': { ...ANTHROPIC_PRICING['opus-5'], input: 42 },
    }
    const fpB = pricingFingerprint(overriddenTable)

    // Mirrors the real defect: worker-entry.ts dispatches each request
    // without awaiting the previous one, so a scanProjects for table A and a
    // watcher-triggered parseSession for table B can have their cache calls
    // interleaved mid-flight, both touching the same in-memory cache object.
    const requestA = (async () => {
      await Promise.resolve()
      setCachedSummary(pathA, 1000, 500, '', fpA, TZ, summaryA)
    })()
    const requestB = (async () => {
      setCachedSummary(pathB, 2000, 600, '', fpB, TZ, summaryB)
    })()
    await Promise.all([requestA, requestB])

    // The core correctness property: reading an entry under the WRONG table
    // is always a miss, never a hit that returns the entry stamped as if it
    // belonged to the other table. A shared "active fingerprint" variable
    // broke exactly this — a call from B could flip the ambient fingerprint
    // mid-flight and cause A's read or write to be silently validated (or
    // persisted) against B's stamp instead of its own.
    expect(getCachedSummary(pathA, 1000, 500, '', fpB, TZ)).toBeUndefined()
    expect(getCachedSummary(pathB, 2000, 600, '', fpA, TZ)).toBeUndefined()

    // Whatever legitimately survived the race under its OWN table must be
    // exactly its own value — interleaving different tables may cost a
    // cache miss (the shared file gets rebuilt when the stamp changes), but
    // must never swap in the other request's summary.
    const hitA = getCachedSummary(pathA, 1000, 500, '', fpA, TZ)
    const hitB = getCachedSummary(pathB, 2000, 600, '', fpB, TZ)
    if (hitA !== undefined) expect(hitA).toEqual(summaryA)
    if (hitB !== undefined) expect(hitB).toEqual(summaryB)
  })
})

describe('pricingFingerprint', () => {
  it('is order-independent: the same rates in a different key order fingerprint identically', () => {
    const forward = { ...ANTHROPIC_PRICING }
    const reversed = Object.fromEntries(Object.entries(forward).reverse()) as Record<
      ModelFamily,
      ModelPricing
    >

    expect(pricingFingerprint(reversed)).toBe(pricingFingerprint(forward))
  })

  it('changes when any single rate changes', () => {
    const changed: Record<ModelFamily, ModelPricing> = {
      ...ANTHROPIC_PRICING,
      'sonnet-5': { ...ANTHROPIC_PRICING['sonnet-5'], cache1h: 0.01 },
    }

    expect(pricingFingerprint(changed)).not.toBe(pricingFingerprint(ANTHROPIC_PRICING))
  })
})
