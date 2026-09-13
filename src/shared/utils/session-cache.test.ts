import { describe, expect, it } from 'vitest'
import type { ParsedRecord, ParsedSession } from '@shared/types/session'
import { SessionCache } from './session-cache'

/** A session whose estimated footprint scales with the record count. */
function session(id: string, records: number): ParsedSession {
  const record: ParsedRecord = {
    type: 'assistant',
    uuid: 'u',
    contentBlocks: [{ type: 'text', text: 'x'.repeat(500) }],
    isCompactionBoundary: false,
  }
  return {
    metadata: { id } as unknown as ParsedSession['metadata'],
    records: Array.from({ length: records }, () => record),
    toolResultMap: {},
  } as ParsedSession
}

describe('SessionCache — capacity', () => {
  it('evicts the least recently used entry past capacity', () => {
    const cache = new SessionCache(2, Number.MAX_SAFE_INTEGER)
    cache.set('a', session('a', 1))
    cache.set('b', session('b', 1))
    cache.set('c', session('c', 1))

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.size).toBe(2)
  })

  it('treats a read as recent use', () => {
    const cache = new SessionCache(2, Number.MAX_SAFE_INTEGER)
    cache.set('a', session('a', 1))
    cache.set('b', session('b', 1))
    cache.get('a')
    cache.set('c', session('c', 1))

    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
  })
})

/**
 * Replacing an existing key skipped the eviction loop entirely, so a session
 * that grew as it streamed pushed the cache past its byte cap and kept it there
 * — the cap only ever applied to brand-new keys. Measured: 492,600 bytes held
 * against a 50,000 cap.
 */
describe('SessionCache — byte cap', () => {
  const PER_RECORD = 1_200 // approximate; assertions use the cap, not this

  it('stays within the cap when an existing entry grows', () => {
    const cap = 24 * PER_RECORD
    const cache = new SessionCache(10, cap)

    cache.set('a', session('a', 2))
    cache.set('b', session('b', 2))
    // 'a' is re-parsed mid-stream and is now much larger.
    cache.set('a', session('a', 20))

    expect(cache.totalBytesUsed).toBeLessThanOrEqual(cap)
    expect(cache.get('a')).toBeDefined()
  })

  it('evicts other entries rather than exceeding the cap', () => {
    const cap = 24 * PER_RECORD
    const cache = new SessionCache(10, cap)

    cache.set('a', session('a', 2))
    cache.set('b', session('b', 2))
    cache.set('c', session('c', 20))

    expect(cache.totalBytesUsed).toBeLessThanOrEqual(cap)
    expect(cache.get('c')).toBeDefined()
  })

  it('does not cache an entry larger than the whole cap', () => {
    const cache = new SessionCache(10, 4 * PER_RECORD)

    cache.set('huge', session('huge', 50))

    // Storing it would break the cap it exists to enforce; the caller re-parses.
    expect(cache.get('huge')).toBeUndefined()
    expect(cache.totalBytesUsed).toBe(0)
  })

  it('does not evict everything for an entry it then refuses', () => {
    // The estimator adds a fixed ~4KB base per session, so the cap has to clear
    // that before a one-record entry fits at all.
    const cache = new SessionCache(10, 12_000)
    cache.set('keep', session('keep', 1))

    cache.set('huge', session('huge', 50))

    expect(cache.get('keep')).toBeDefined()
  })

  it('reports a byte total that matches what it holds', () => {
    const cache = new SessionCache(10, Number.MAX_SAFE_INTEGER)
    cache.set('a', session('a', 5))
    cache.set('b', session('b', 5))
    const withBoth = cache.totalBytesUsed

    cache.invalidate('b')

    expect(cache.totalBytesUsed).toBeLessThan(withBoth)
    expect(cache.totalBytesUsed).toBeGreaterThan(0)
  })

  it('returns to zero bytes once cleared', () => {
    const cache = new SessionCache(10, Number.MAX_SAFE_INTEGER)
    cache.set('a', session('a', 5))
    cache.clear()

    expect(cache.totalBytesUsed).toBe(0)
    expect(cache.size).toBe(0)
  })
})
