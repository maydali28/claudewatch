import * as fs from 'fs'
import * as path from 'path'
import type { SessionSummary } from '@shared/types/session'
import { PRICING_REVISION } from '@shared/constants/pricing'
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
  summary: SessionSummary
}

interface CacheFile {
  version: number
  pricingRevision: number
  entries: Record<string, CachedEntry>
}

const CACHE_VERSION = 3
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

function load(): CacheFile {
  if (inMemory) return inMemory
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
    if (parsed.pricingRevision !== PRICING_REVISION) {
      throw new Error('Pricing revision changed')
    }
    inMemory = parsed
  } catch {
    inMemory = { version: CACHE_VERSION, pricingRevision: PRICING_REVISION, entries: {} }
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
 * what we cached. Returns undefined on miss or stale entry.
 */
export function getCachedSummary(
  filePath: string,
  mtimeMs: number,
  size: number
): SessionSummary | undefined {
  const entry = load().entries[makeKey(filePath)]
  if (!entry) return undefined
  if (entry.mtimeMs !== mtimeMs || entry.size !== size) return undefined
  return entry.summary
}

/** Persist a freshly-parsed summary against its file fingerprint. */
export function setCachedSummary(
  filePath: string,
  mtimeMs: number,
  size: number,
  summary: SessionSummary
): void {
  const file = load()
  file.entries[makeKey(filePath)] = { mtimeMs, size, summary }
  scheduleFlush()
}

/** Drop a single entry — used when a file is deleted. */
export function invalidateCachedSummary(filePath: string): void {
  const file = load()
  delete file.entries[makeKey(filePath)]
  scheduleFlush()
}

/**
 * Drop entries whose underlying file no longer exists. Called once per app
 * launch after the scan so the cache file does not grow forever as users
 * delete projects or sessions.
 */
export function pruneCachedSummaries(existingPaths: Set<string>): void {
  const file = load()
  let removed = 0
  for (const key of Object.keys(file.entries)) {
    if (!existingPaths.has(key)) {
      delete file.entries[key]
      removed++
    }
  }
  if (removed > 0) scheduleFlush()
}
