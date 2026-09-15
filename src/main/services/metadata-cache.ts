import * as fs from 'fs'
import * as path from 'path'
import type { SessionSummary } from '@shared/types/session'
import { createLogger } from '@main/lib/logger'

const log = createLogger('MetadataCache')

/**
 * Disk-cached session metadata keyed by `(mtime, size)`. The first launch
 * still pays for a full parse, but subsequent launches reuse the cached
 * summary for any file whose mtime+size pair is unchanged — typical case is
 * "open the app, browse projects" without re-parsing the same megabytes.
 *
 * The cache is single-file JSON (atomic rename on write). It is not the
 * source of truth for anything: corrupt or missing → fall back to a fresh
 * parse and re-populate. We do not store this in `~/.claude` because that
 * directory is owned by Claude Code, not us.
 */

interface CachedEntry {
  mtimeMs: number
  size: number
  /**
   * Identity of every subagent transcript rolled into `summary`, from
   * `childFingerprint()`. The parent file's own mtime/size say nothing about
   * its children: a subagent written after the parent (or while the app was
   * closed) must invalidate the entry even though the parent is untouched.
   */
  childFingerprint: string
  summary: SessionSummary
}

interface CacheFile {
  version: number
  /** `pricingFingerprint()` of the table every entry below was priced at. */
  pricingFingerprint: string
  /**
   * `currentTimezone()` at the time every entry below was parsed. Every
   * `dayLocal` key on a cached summary is a calendar day computed in this
   * zone (see `toDateKey` in `shared/utils/date-ranges.ts`) — flying to
   * another timezone and reopening the app must not mix day boundaries from
   * two zones inside one cached history.
   */
  timezone: string
  entries: Record<string, CachedEntry>
}

// This version covers the SHAPE of `SessionSummary` (what a cached `summary`
// contains), not just the file envelope around it — `dailyUsage` once landed
// on `SessionSummary` without a version bump, which was a near miss: an
// upgrading cache silently served summaries missing the field instead of
// being discarded. Bump this whenever a `SessionSummary` field is added,
// renamed, or reinterpreted, even when the envelope (`CacheFile`) is
// unchanged.
// v5: entries gained `childFingerprint` (see CachedEntry) — bumped so old
// caches are discarded rather than read back with the field missing, which
// would silently pass the wrong (undefined-mismatches-everything) semantics.
// v6: the file gained top-level `timezone`, for the same reason as v5 —
// discard explicitly rather than rely on `undefined !== timezone` doing the
// right thing by accident.
// v7: `SessionSummary` gained `diagnostics`, `thinkingTokens`,
// `recordedEffortDistribution` and `serviceTiers` after the v6 bump, so a
// cache written mid-branch at v6 has a v6-minus shape for these fields.
// v8: the one-completeness-contract fix reinterprets, not just adds to, the
// SAME fields a v7 cache already carries — `estimatedCost` and
// `totalCacheCreation*Tokens` now price a partial cache-write's unexplained
// remainder consistently everywhere instead of dropping it, undated
// activity lands in an explicit bucket instead of vanishing from
// `dailyUsage`, and `usageIncomplete`/diagnostics fire for a missing or
// wrong-typed counter that a v7 cache silently priced as a measured zero.
// A version bump that only covers ADDED fields would leave a v7 entry's
// existing numbers stale and unmarked; discard it instead.
// v9: ONE bump covering every persisted change this branch made since v8.
// That is sufficient — `parsed.version !== CACHE_VERSION` below discards all
// v8 wholesale, so no v8 summary can be served under any of the new
// contracts — but the list has to be complete, or the next reader cannot
// tell which of these a cache predates. It named two of seven:
//   1. The cache-write volume reconciliation (`effectiveCacheWriteTotal` /
//      `cacheWriteUnknownTtl` in `ledger.ts`) reprices a response whose TTL
//      tiers report MORE than the flat counter — a v8 cache's `estimatedCost`
//      and `totalCacheCreation*Tokens` can be stale for such a response.
//   2. The completeness-contract widening: `SessionSummary.diagnostics`
//      and `dailyUsage[].*` gain `unpricedResponses`, `incompleteUsageResponses`,
//      `responsesWithoutCompletionSignal` and `reducedConfidenceResponses`.
//      These were already detected by the ledger but went no further than a
//      `log.warn`; a persisted v8 summary carries only the original four
//      diagnostics, and serving it back under the widened contract would
//      report the four new counts as a measured zero instead of "never
//      computed".
//   3. The day-key change: a v8 cache's `dailyUsage` carries `NaN-NaN-NaN`
//      KEYS for a record whose timestamp was present but unparsable. The
//      range filter treats that string differently from `(undated)` — it
//      sorts above every real day key rather than below — so the same
//      activity lands on the opposite side of every bounded range.
//   4. The provisional-field recovery: a v8 summary froze a coerced `0`
//      where v9 recovers the real measurement from a later snapshot, so
//      `totalInputTokens` and `estimatedCost` genuinely differ for any
//      response whose first snapshot carried an invalid counter.
//   5. Thinking-token validation, which landed THREE COMMITS AFTER this
//      constant was bumped: an invalid `thinking_tokens` is now dropped to
//      `undefined` rather than coerced to a measured `0`, changing a
//      persisted VALUE.
//   6. The undated-response accounting, which landed later still: a response
//      with no timestamp is now bucketed into `(undated)` with its tokens
//      and its cost instead of being dropped, and a response whose first
//      record was undated is relocated when a later one carries a usable
//      timestamp. Both change persisted `dailyUsage` rows and the totals
//      derived from them.
//   7. The `laterTimestamp` fix (`9ad4a60`): comparing with `>` against a
//      `NaN` is always false, so whenever the LEFT side was the unparsable
//      one the function returned it and discarded a perfectly good right
//      side. That value anchors the next turn's `prevTimestamp`, so a v8
//      summary's persisted `turnDurations` can carry a wrong anchor — and
//      therefore a wrong `durationMs` — for any turn following a malformed
//      record.
//
// Items 5, 6 and 7 are why the rule at the top of this comment matters more
// than the bump itself: a change that alters a persisted VALUE needs this
// constant bumped even when no field is added or renamed, and a bump that
// already happened earlier on the same branch does not cover it for anyone
// who built in between. No shipped release carries a v9 cache, so no user is
// affected; a developer who ran a build mid-branch holds a v9 cache that is
// never invalidated, and re-parsing is the documented recovery.
//
// Pinned by `metadata-cache-version.test.ts`, in both directions — reverting
// this number to 8 used to leave the whole suite green.
const CACHE_VERSION = 9
const CACHE_FILENAME = 'session-metadata-cache.json'

// The cache lives wherever the owner says. This module runs inside the
// accounting worker, a plain Node thread with no Electron `app` to ask, so the
// directory is supplied by main at spawn rather than resolved here.
let cachePath: string | null = null
/**
 * Directory to hold the cache file, when it cannot be asked of Electron.
 *
 * The accounting worker is a plain Node thread with no `app`, so main resolves
 * the path once and hands it over at spawn. Without this the worker throws the
 * moment it touches the cache.
 */
export function configureMetadataCacheDir(dir: string): void {
  cachePath = path.join(dir, CACHE_FILENAME)
}

function getCachePath(): string {
  if (!cachePath) {
    throw new Error(
      'Metadata cache directory not configured — call configureMetadataCacheDir() first'
    )
  }
  return cachePath
}

let inMemory: CacheFile | null = null

/**
 * Load the cache file, validated against the pricing table the CALLER is
 * about to read or write under.
 *
 * `pricingFingerprint` is a parameter rather than module state on purpose:
 * the worker does not serialize requests (`worker-entry.ts` dispatches each
 * message without awaiting the previous one), so a `scanProjects` in flight
 * for table A can be interleaved with a watcher-triggered `parseSession` for
 * table B. A shared "active fingerprint" variable set once per request would
 * let B's call overwrite A's mid-scan and silently mislabel the rest of A's
 * writes — the exact bug this cache exists to prevent, reintroduced through
 * the fix's own state. Threading the fingerprint through the call keeps each
 * request self-contained: what it reads and stamps depends only on the
 * argument it passed, never on what some other in-flight request just did.
 *
 * `timezone` is threaded the same way and for the same reason — see the
 * `CacheFile.timezone` doc comment. It is NOT module state here either: the
 * caller computes `currentTimezone()` itself (see `project-scanner.ts` /
 * `worker-entry.ts`) and passes it through, so this file never needs its own
 * ambient notion of "the current zone".
 */
function load(pricingFingerprint: string, timezone: string): CacheFile {
  if (
    inMemory &&
    inMemory.pricingFingerprint === pricingFingerprint &&
    inMemory.timezone === timezone
  ) {
    return inMemory
  }
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8')
    const parsed = JSON.parse(raw) as CacheFile
    if (parsed.version !== CACHE_VERSION || typeof parsed.entries !== 'object') {
      throw new Error('Cache file shape mismatch')
    }
    // Cached summaries carry `estimatedCost` and `modelBreakdown` baked in at
    // the rates and model mapping in force when they were parsed. A pricing
    // correction must therefore discard them: keeping them would leave totals
    // that mix old and new pricing, which is harder to explain than being
    // uniformly wrong. A full rebuild is ~1.4s for a 580-file history.
    if (parsed.pricingFingerprint !== pricingFingerprint) {
      throw new Error('Pricing fingerprint changed')
    }
    // `dayLocal` keys are calendar days in the reporting zone. Flying to
    // Tokyo and reopening the app must not mix day boundaries from two zones.
    if (parsed.timezone !== timezone) {
      throw new Error('Reporting timezone changed')
    }
    inMemory = parsed
  } catch {
    inMemory = { version: CACHE_VERSION, pricingFingerprint, timezone, entries: {} }
  }
  return inMemory
}

/**
 * Read the cache file for structural housekeeping (deleting entries) that
 * doesn't depend on any particular pricing table. Reuses whatever is already
 * in memory rather than forcing a fingerprint match — a prune or invalidate
 * that runs between two differently-priced requests should not itself
 * trigger a discard-and-rebuild.
 */
function loadForHousekeeping(): CacheFile | null {
  if (inMemory) return inMemory
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8')
    const parsed = JSON.parse(raw) as CacheFile
    if (parsed.version !== CACHE_VERSION || typeof parsed.entries !== 'object') {
      throw new Error('Cache file shape mismatch')
    }
    inMemory = parsed
  } catch {
    return null
  }
  return inMemory
}

let writeTimer: ReturnType<typeof setTimeout> | null = null
function scheduleFlush(): void {
  if (writeTimer) return
  // Coalesce bursty writes during a full scan into one flush per second.
  writeTimer = setTimeout(() => {
    writeTimer = null
    flush()
  }, 1000)
}

function flush(): void {
  if (!inMemory) return
  const target = getCachePath()
  const tmp = `${target}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(inMemory))
    fs.renameSync(tmp, target)
  } catch (e) {
    log.warn('Failed to persist metadata cache:', e)
  }
}

function makeKey(filePath: string): string {
  return filePath
}

/**
 * Look up a previously-parsed summary if the file's mtime and size match
 * what we cached, no subagent transcript has appeared or changed since, the
 * cache file itself was priced under the same table this caller is using,
 * and it was built under the same reporting timezone this caller is using.
 * `pricingFingerprint` is `pricingFingerprint()` of that table and
 * `timezone` is `currentTimezone()` — see `load()` for why both are
 * parameters instead of ambient state.
 * Returns undefined on miss or stale entry.
 */
export function getCachedSummary(
  filePath: string,
  mtimeMs: number,
  size: number,
  childFingerprint: string,
  pricingFingerprint: string,
  timezone: string
): SessionSummary | undefined {
  const entry = load(pricingFingerprint, timezone).entries[makeKey(filePath)]
  if (!entry) return undefined
  if (entry.mtimeMs !== mtimeMs || entry.size !== size) return undefined
  if (entry.childFingerprint !== childFingerprint) return undefined
  return entry.summary
}

/**
 * Persist a freshly-parsed summary against its file, child fingerprint, the
 * pricing table it was priced with, and the reporting timezone its
 * `dayLocal` keys were bucketed under.
 */
export function setCachedSummary(
  filePath: string,
  mtimeMs: number,
  size: number,
  childFingerprint: string,
  pricingFingerprint: string,
  timezone: string,
  summary: SessionSummary
): void {
  const file = load(pricingFingerprint, timezone)
  file.entries[makeKey(filePath)] = { mtimeMs, size, childFingerprint, summary }
  scheduleFlush()
}

/** Drop a single entry — used when a file is deleted. */
export function invalidateCachedSummary(filePath: string): void {
  const file = loadForHousekeeping()
  if (!file) return
  delete file.entries[makeKey(filePath)]
  scheduleFlush()
}

/**
 * Drop entries whose underlying file no longer exists. Called once per app
 * launch after the scan so the cache file does not grow forever as users
 * delete projects or sessions.
 */
export function pruneCachedSummaries(existingPaths: Set<string>): void {
  const file = loadForHousekeeping()
  if (!file) return
  let removed = 0
  for (const key of Object.keys(file.entries)) {
    if (!existingPaths.has(key)) {
      delete file.entries[key]
      removed++
    }
  }
  if (removed > 0) scheduleFlush()
}
