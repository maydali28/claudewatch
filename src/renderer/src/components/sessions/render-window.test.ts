import { describe, expect, it } from 'vitest'
import { windowAfterScroll, windowAfterAppend, scrollTopAfterPrepend } from './render-window'

const BATCH = 50
const AHEAD = 1500

/**
 * How many transcript records stay mounted.
 *
 * The window is a suffix of the transcript: a session opens on its newest
 * records, and older ones are mounted as the reader scrolls up toward them.
 * Mounting everything up front is what made long sessions expensive to open.
 */
describe('windowAfterScroll', () => {
  it('extends when the reader nears the top of the mounted records', () => {
    expect(windowAfterScroll(50, 1000, 200, BATCH, AHEAD)).toBe(100)
  })

  it('leaves the window alone while the reader is far from the top', () => {
    expect(windowAfterScroll(50, 1000, 9_000, BATCH, AHEAD)).toBe(50)
  })

  it('never exceeds the number of records available', () => {
    expect(windowAfterScroll(980, 1000, 0, BATCH, AHEAD)).toBe(1000)
  })

  it('is a no-op once everything is mounted', () => {
    expect(windowAfterScroll(1000, 1000, 0, BATCH, AHEAD)).toBe(1000)
  })
})

/**
 * A live session appends records while it is open. The tail is always inside
 * a suffix window, so the window grows by the number of appended records:
 * the oldest mounted message stays mounted and nothing above the reader
 * disappears when new turns arrive below them.
 */
describe('windowAfterAppend', () => {
  it('grows by the number of appended records so the oldest mounted one stays', () => {
    expect(windowAfterAppend(100, 500, 504)).toBe(104)
  })

  it('stays put when nothing was appended', () => {
    expect(windowAfterAppend(100, 500, 500)).toBe(100)
  })

  it('keeps a fully mounted transcript fully mounted', () => {
    expect(windowAfterAppend(500, 500, 504)).toBe(504)
  })

  it('leaves unmounted history unmounted', () => {
    expect(windowAfterAppend(498, 500, 504)).toBe(502)
  })

  it('caps to the new total when records disappear', () => {
    // Filtering by a search term can shrink the set; the window must not
    // point past it.
    expect(windowAfterAppend(100, 500, 80)).toBe(80)
  })
})

/**
 * Older records mount above the viewport. Without a correction the browser
 * keeps `scrollTop` and the reader is thrown up by the height of everything
 * that was just inserted. Shifting by the growth keeps the same message under
 * their eye.
 */
describe('scrollTopAfterPrepend', () => {
  it('shifts the scroll position by the height that was inserted above', () => {
    expect(scrollTopAfterPrepend(120, 4_000, 6_500)).toBe(2_620)
  })

  it('is a no-op when nothing was inserted', () => {
    expect(scrollTopAfterPrepend(120, 4_000, 4_000)).toBe(120)
  })
})
