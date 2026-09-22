import { describe, expect, it } from 'vitest'
import { needsCollapse, hiddenLines } from './collapsible-text-rules'

describe('needsCollapse', () => {
  it('leaves content that fits alone', () => {
    expect(needsCollapse(200, 320, 48)).toBe(false)
  })

  it('leaves content that is only slightly over alone — a button revealing two lines is noise', () => {
    expect(needsCollapse(320, 320, 48)).toBe(false)
    expect(needsCollapse(368, 320, 48)).toBe(false)
  })

  it('collapses content that is clearly over', () => {
    expect(needsCollapse(369, 320, 48)).toBe(true)
    expect(needsCollapse(2000, 320, 48)).toBe(true)
  })
})

describe('hiddenLines', () => {
  it('reports how many lines the clamp hides, rounded to whole lines', () => {
    expect(hiddenLines(1000, 320, 20)).toBe(34)
    expect(hiddenLines(330, 320, 20)).toBe(1)
  })

  it('never reports a negative count', () => {
    expect(hiddenLines(100, 320, 20)).toBe(0)
  })

  it('falls back to zero when the line height is unknown', () => {
    expect(hiddenLines(1000, 320, 0)).toBe(0)
    expect(hiddenLines(1000, 320, Number.NaN)).toBe(0)
  })
})
