import { describe, expect, it } from 'vitest'
import { contextFillView } from './context-fill-rules'

const fill = (tokens: number, window = 200_000, windowEstimated = false) => ({
  tokens,
  window,
  windowEstimated,
})

describe('contextFillView', () => {
  it('shows the share of the window in use', () => {
    const view = contextFillView(fill(68_000))
    expect(view.percent).toBe(34)
    expect(view.label).toBe('34% of 200K')
    expect(view.level).toBe('normal')
  })

  it('names a 1M window without a decimal', () => {
    expect(contextFillView(fill(250_000, 1_000_000)).label).toBe('25% of 1M')
  })

  it('warns from 80% and alerts from 95%, where Claude Code is about to compact', () => {
    expect(contextFillView(fill(159_999)).level).toBe('normal')
    expect(contextFillView(fill(160_000)).level).toBe('warning')
    expect(contextFillView(fill(189_999)).level).toBe('warning')
    expect(contextFillView(fill(190_000)).level).toBe('critical')
  })

  it('caps the bar at 100% when a window guess falls short', () => {
    const view = contextFillView(fill(230_000))
    expect(view.percent).toBe(100)
    expect(view.label).toBe('100% of 200K')
  })

  it('marks an estimated window in the label and the description', () => {
    const view = contextFillView(fill(50_000, 200_000, true))
    expect(view.label).toBe('25% of ~200K')
    expect(view.description).toBe('50.0K of ~200K context (estimated window)')
  })

  it('describes a known window plainly, with compactions when there were any', () => {
    expect(contextFillView(fill(50_000)).description).toBe('50.0K of 200K context')
    expect(contextFillView(fill(50_000), 2).description).toBe(
      '50.0K of 200K context · compacted 2×'
    )
  })

  it('shows nothing for a session with no response yet', () => {
    const view = contextFillView(undefined)
    expect(view.percent).toBe(0)
    expect(view.label).toBeUndefined()
    expect(view.level).toBe('normal')
    expect(view.description).toBe('No context recorded yet')
  })
})
