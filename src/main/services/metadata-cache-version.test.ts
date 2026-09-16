import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { SessionSummary } from '@shared/types/session'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'

// See metadata-cache.test.ts: electron-log's import-time initialize() throws
// under vitest's pool, so anything importing this module must mock it first.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { configureMetadataCacheDir, getCachedSummary } from './metadata-cache'
import { pricingFingerprint } from './pricing-engine'

/**
 * `CACHE_VERSION` is the only thing standing between a stale v8 summary and
 * the widened v9 contract, and nothing tested it: reverting the constant from
 * 9 to 8 left all 567 tests green, even with a `metadata-cache.test.ts` in
 * the suite. A silent revert — or a "cleanup" that renumbers it — would ship
 * summaries whose `estimatedCost`, `dailyUsage` day keys and four new
 * diagnostics counts all predate the contract reading them.
 *
 * Pinned through behaviour rather than by exporting the constant: a cache
 * file stamped 9 must be honoured and one stamped 8 must be discarded. Both
 * directions are asserted, so the number cannot drift either way — moving it
 * to 8 fails the first, moving it to 10 fails the first as well, and deleting
 * the check entirely fails the second.
 *
 * Deliberately its own file. `metadata-cache.ts` keeps module-global
 * `inMemory` state and a 1-second debounced flush, so a test that hand-writes
 * the cache file can be clobbered by a flush another test scheduled. Vitest
 * isolates per file, so nothing here shares that timer.
 */
const FP = pricingFingerprint(ANTHROPIC_PRICING)
const TZ = 'America/New_York'
const CACHE_FILENAME = 'session-metadata-cache.json'
const ENTRY_PATH = '/fake/project/version-pin.jsonl'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-cache-version-'))
  configureMetadataCacheDir(dir)
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * Hand-write a cache file at `version`, holding one entry that would be a hit
 * for `ENTRY_PATH`. A unique `timezone` per call forces `load` past its
 * in-memory short-circuit and back to disk, so each test really reads the
 * bytes it just wrote.
 */
function writeCacheFile(version: number, timezone: string): void {
  const file: unknown = {
    version,
    pricingFingerprint: FP,
    timezone,
    entries: {
      [ENTRY_PATH]: {
        mtimeMs: 1000,
        size: 500,
        childFingerprint: 'child-fp',
        summary: { id: 'pinned-session' } as unknown as SessionSummary,
      },
    },
  }
  fs.writeFileSync(path.join(dir, CACHE_FILENAME), JSON.stringify(file))
}

describe('CACHE_VERSION', () => {
  it('serves an entry from a cache file stamped with the current version', () => {
    const tz = `${TZ}-current`
    writeCacheFile(11, tz)

    const hit = getCachedSummary(ENTRY_PATH, 1000, 500, 'child-fp', FP, tz)

    // If the constant is not 11, this file is rejected as a shape mismatch and
    // the entry vanishes — which is exactly what a silent revert to 10, or a
    // bump to 12 without a matching migration, would do.
    expect(hit).toBeDefined()
    expect(hit!.id).toBe('pinned-session')
  })

  it('discards a v10 cache file rather than serving it under the v11 contract', () => {
    const tz = `${TZ}-stale`
    writeCacheFile(10, tz)

    // A v10 summary was parsed before `ai-title` records were read, so its
    // `title` is the slug or the bare session id for every session that has
    // a Claude-generated name. Serving it back would keep showing ids until
    // each transcript happened to change. See `CACHE_VERSION`'s v11 note.
    expect(getCachedSummary(ENTRY_PATH, 1000, 500, 'child-fp', FP, tz)).toBeUndefined()
  })

  it('discards every version below the current one, not just the immediately previous', () => {
    for (const stale of [1, 5, 6, 7, 8, 9, 10]) {
      const tz = `${TZ}-stale-${stale}`
      writeCacheFile(stale, tz)
      expect(getCachedSummary(ENTRY_PATH, 1000, 500, 'child-fp', FP, tz)).toBeUndefined()
    }
  })
})
