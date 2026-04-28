import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
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
  summary: SessionSummary
}

interface CacheFile {
  version: number
  entries: Record<string, CachedEntry>
}

const CACHE_VERSION = 1
const CACHE_FILENAME = 'session-metadata-cache.json'

// Lazily resolved on first access — `app.getPath('userData')` is unavailable
// before the `ready` event, so importing this module in a test environment
// won't blow up.
let cachePath: string | null = null
function getCachePath(): string {
  if (cachePath) return cachePath
  cachePath = path.join(app.getPath('userData'), CACHE_FILENAME)
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
    inMemory = parsed
  } catch {
    inMemory = { version: CACHE_VERSION, entries: {} }
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
