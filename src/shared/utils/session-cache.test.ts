import { describe, expect, it } from 'vitest'
import type { ParsedRecord, ParsedSession } from '@shared/types/session'
import { SessionCache } from './session-cache'

/** A fixed project id for tests that aren't exercising cross-project keying. */
const PROJ = 'proj'

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
    cache.set(PROJ, 'a', session('a', 1))
    cache.set(PROJ, 'b', session('b', 1))
    cache.set(PROJ, 'c', session('c', 1))

    expect(cache.get(PROJ, 'a')).toBeUndefined()
    expect(cache.get(PROJ, 'b')).toBeDefined()
    expect(cache.get(PROJ, 'c')).toBeDefined()
    expect(cache.size).toBe(2)
  })

  it('treats a read as recent use', () => {
    const cache = new SessionCache(2, Number.MAX_SAFE_INTEGER)
    cache.set(PROJ, 'a', session('a', 1))
    cache.set(PROJ, 'b', session('b', 1))
    cache.get(PROJ, 'a')
    cache.set(PROJ, 'c', session('c', 1))

    expect(cache.get(PROJ, 'a')).toBeDefined()
    expect(cache.get(PROJ, 'b')).toBeUndefined()
  })
})

/**
 * Session ids are only unique within a project. Keying the cache on the bare
 * session id let two projects sharing an id silently read and evict each
 * other's parsed sessions.
 */
describe('SessionCache — project scoping', () => {
  it('does not collide when two projects hold the same session id', () => {
    const cache = new SessionCache(10, Number.MAX_SAFE_INTEGER)
    const sameId = 'shared-session-id'
    const forProjectA = session(sameId, 1)
    const forProjectB = session(sameId, 5)

    cache.set('project-a', sameId, forProjectA)
    cache.set('project-b', sameId, forProjectB)

    expect(cache.get('project-a', sameId)).toBe(forProjectA)
    expect(cache.get('project-b', sameId)).toBe(forProjectB)
    expect(cache.size).toBe(2)
  })

  it('invalidates only the named project’s entry for a shared session id', () => {
    const cache = new SessionCache(10, Number.MAX_SAFE_INTEGER)
    const sameId = 'shared-session-id'
    cache.set('project-a', sameId, session(sameId, 1))
    cache.set('project-b', sameId, session(sameId, 1))

    cache.invalidate('project-a', sameId)

    expect(cache.get('project-a', sameId)).toBeUndefined()
    expect(cache.get('project-b', sameId)).toBeDefined()
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

    cache.set(PROJ, 'a', session('a', 2))
    cache.set(PROJ, 'b', session('b', 2))
    // 'a' is re-parsed mid-stream and is now much larger.
    cache.set(PROJ, 'a', session('a', 20))

    expect(cache.totalBytesUsed).toBeLessThanOrEqual(cap)
    expect(cache.get(PROJ, 'a')).toBeDefined()
  })

  it('evicts other entries rather than exceeding the cap', () => {
    const cap = 24 * PER_RECORD
    const cache = new SessionCache(10, cap)

    cache.set(PROJ, 'a', session('a', 2))
    cache.set(PROJ, 'b', session('b', 2))
    cache.set(PROJ, 'c', session('c', 20))

    expect(cache.totalBytesUsed).toBeLessThanOrEqual(cap)
    expect(cache.get(PROJ, 'c')).toBeDefined()
  })

  it('does not cache an entry larger than the whole cap', () => {
    const cache = new SessionCache(10, 4 * PER_RECORD)

    cache.set(PROJ, 'huge', session('huge', 50))

    // Storing it would break the cap it exists to enforce; the caller re-parses.
    expect(cache.get(PROJ, 'huge')).toBeUndefined()
    expect(cache.totalBytesUsed).toBe(0)
  })

  it('does not evict everything for an entry it then refuses', () => {
    // The estimator adds a fixed ~4KB base per session, so the cap has to clear
    // that before a one-record entry fits at all.
    const cache = new SessionCache(10, 12_000)
    cache.set(PROJ, 'keep', session('keep', 1))

    cache.set(PROJ, 'huge', session('huge', 50))

    expect(cache.get(PROJ, 'keep')).toBeDefined()
  })

  it('reports a byte total that matches what it holds', () => {
    const cache = new SessionCache(10, Number.MAX_SAFE_INTEGER)
    cache.set(PROJ, 'a', session('a', 5))
    cache.set(PROJ, 'b', session('b', 5))
    const withBoth = cache.totalBytesUsed

    cache.invalidate(PROJ, 'b')

    expect(cache.totalBytesUsed).toBeLessThan(withBoth)
    expect(cache.totalBytesUsed).toBeGreaterThan(0)
  })

  it('returns to zero bytes once cleared', () => {
    const cache = new SessionCache(10, Number.MAX_SAFE_INTEGER)
    cache.set(PROJ, 'a', session('a', 5))
    cache.clear()

    expect(cache.totalBytesUsed).toBe(0)
    expect(cache.size).toBe(0)
  })
})
