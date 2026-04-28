import type { ParsedSession } from '@shared/types/session'

// ─── LRU Cache for ParsedSession ──────────────────────────────────────────────
//
// Evicts by both count (capacity) and total byte footprint (maxBytes). Byte
// sizing samples the first few records via JSON.stringify and extrapolates,
// so dense thinking-heavy sessions are accounted for without paying for a
// full serialise on every insert. Shared between main (authoritative, large
// cap) and renderer (small cap, used to keep navigation instant on revisit).

export class SessionCache {
  private readonly capacity: number
  private readonly maxBytes: number
  private readonly cache: Map<string, { session: ParsedSession; bytes: number }>
  private totalBytes = 0

  constructor(capacity: number, maxBytes: number) {
    this.capacity = capacity
    this.maxBytes = maxBytes
    this.cache = new Map()
  }

  get(sessionId: string): ParsedSession | undefined {
    const entry = this.cache.get(sessionId)
    if (!entry) return undefined
    this.cache.delete(sessionId)
    this.cache.set(sessionId, entry)
    return entry.session
  }

  set(sessionId: string, session: ParsedSession): void {
    const bytes = estimateSessionBytes(session)

    if (this.cache.has(sessionId)) {
      const old = this.cache.get(sessionId)!
      this.totalBytes -= old.bytes
      this.cache.delete(sessionId)
    } else {
      while (
        this.cache.size >= this.capacity ||
        (this.totalBytes + bytes > this.maxBytes && this.cache.size > 0)
      ) {
        const lruKey = this.cache.keys().next().value
        if (lruKey === undefined) break
        const lruEntry = this.cache.get(lruKey)!
        this.totalBytes -= lruEntry.bytes
        this.cache.delete(lruKey)
      }
    }

    this.cache.set(sessionId, { session, bytes })
    this.totalBytes += bytes
  }

  invalidate(sessionId: string): void {
    const entry = this.cache.get(sessionId)
    if (entry) {
      this.totalBytes -= entry.bytes
      this.cache.delete(sessionId)
    }
  }

  clear(): void {
    this.cache.clear()
    this.totalBytes = 0
  }

  get size(): number {
    return this.cache.size
  }
}

/**
 * Approximate the in-memory byte footprint of a ParsedSession. Sampling
 * `JSON.stringify` on a fixed window of records and extrapolating is ~100x
 * cheaper than serialising the full session, while accurate to within a
 * factor of 2 — good enough for eviction decisions where overshooting by
 * 50% just means the next set() drops one extra entry.
 *
 * UTF-16 in-memory cost is roughly `string.length * 2` bytes; we use that
 * over `Buffer.byteLength` so the cache works in both main and renderer.
 */
function estimateSessionBytes(session: ParsedSession): number {
  const recordCount = session.records.length
  if (recordCount === 0) return 4096

  const sampleSize = Math.min(recordCount, 8)
  const stride = Math.max(1, Math.floor(recordCount / sampleSize))
  let sampledChars = 0
  let sampled = 0
  for (let i = 0; i < recordCount && sampled < sampleSize; i += stride) {
    try {
      sampledChars += JSON.stringify(session.records[i]).length
    } catch {
      sampledChars += 2048
    }
    sampled++
  }
  const avgCharsPerRecord = sampled > 0 ? sampledChars / sampled : 2048
  return Math.ceil(avgCharsPerRecord * recordCount * 2 + 4096)
}

// Default singleton — sized for the main process (150 MB cap, 20 entries).
// Each Electron process loads this module independently and gets its own
// instance, so importing from main and renderer does not share state.
export const sessionCache = new SessionCache(20, 150 * 1024 * 1024)
