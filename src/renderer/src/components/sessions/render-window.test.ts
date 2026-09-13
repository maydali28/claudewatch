import { describe, expect, it } from 'vitest'
import { windowAfterScroll, windowAfterAppend } from './render-window'

const BATCH = 50
const AHEAD = 1500

/**
 * How many transcript records stay mounted.
 *
 * The panel used to expand the window on every idle tick until every record was
 * mounted, so opening a session with 3,827 records eventually mounted 3,827
 * markdown-rendering components whether or not the reader ever scrolled that
 * far. The window now follows the reader.
 */
describe('windowAfterScroll', () => {
  it('extends when the reader nears the rendered tail', () => {
    expect(windowAfterScroll(50, 1000, 200, BATCH, AHEAD)).toBe(100)
  })

  it('leaves the window alone while the reader is far from the tail', () => {
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
 * A live session appends records while it is open. Someone who has read to the
 * end expects to keep seeing new turns; someone still reading the top does not
 * want the whole history mounted behind them.
 */
describe('windowAfterAppend', () => {
  it('keeps the newest records mounted for a reader at the tail', () => {
    expect(windowAfterAppend(100, 104, true, true)).toBe(104)
  })

  it('leaves the window alone for a reader who has not reached the end', () => {
    expect(windowAfterAppend(100, 104, false, true)).toBe(100)
  })

  it('leaves the window alone for a reader who scrolled away from the tail', () => {
    expect(windowAfterAppend(100, 104, true, false)).toBe(100)
  })

  it('does not shrink the window when records disappear', () => {
    // Filtering by a search term can reduce the set; the window must not grow
    // past it, but neither should it thrash.
    expect(windowAfterAppend(100, 80, true, true)).toBe(80)
  })
})
