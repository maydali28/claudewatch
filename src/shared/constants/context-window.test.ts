import { describe, expect, it } from 'vitest'
import { contextWindowFor } from './context-window'

describe('contextWindowFor', () => {
  // Claude Code runs every 5.x model on the full 1M window: their sessions
  // auto-compact at ~967K, not near 200K.
  it.each([
    'claude-fable-5-1',
    'claude-mythos-5-1',
    'claude-fable-5',
    'claude-mythos-5',
    'claude-opus-5-5',
    'claude-opus-5',
    'claude-sonnet-5-5',
    'claude-sonnet-5',
  ])('%s has a fixed 1M window', (model) => {
    expect(contextWindowFor(model, 0)).toEqual({ tokens: 1_000_000, estimated: false })
  })

  // These cannot be given more than 200K, however the session is configured.
  it.each([
    'claude-haiku-4-5',
    'claude-3-5-haiku',
    'claude-opus-4-5',
    'claude-opus-4-1',
    'claude-opus-4',
  ])('%s has a fixed 200K window', (model) => {
    expect(contextWindowFor(model, 150_000)).toEqual({ tokens: 200_000, estimated: false })
  })

  describe.each([
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-sonnet-4',
  ])('%s, where 1M is opt-in', (model) => {
    it('assumes 200K while the session has stayed within it', () => {
      expect(contextWindowFor(model, 200_000)).toEqual({ tokens: 200_000, estimated: true })
    })

    it('switches to 1M once the session has gone past 200K', () => {
      expect(contextWindowFor(model, 200_001)).toEqual({ tokens: 1_000_000, estimated: true })
    })
  })

  it('treats an unrecognised model like an opt-in one', () => {
    expect(contextWindowFor('claude-opus-9', 10)).toEqual({ tokens: 200_000, estimated: true })
    expect(contextWindowFor('claude-opus-9', 300_000)).toEqual({
      tokens: 1_000_000,
      estimated: true,
    })
    expect(contextWindowFor(undefined, 0)).toEqual({ tokens: 200_000, estimated: true })
  })

  it('reads provider-routed and dated IDs like the bare ones', () => {
    expect(contextWindowFor('us.anthropic.claude-haiku-4-5-20251001-v1:0', 0)).toEqual({
      tokens: 200_000,
      estimated: false,
    })
    expect(contextWindowFor('claude-opus-5-5@20260101', 0)).toEqual({
      tokens: 1_000_000,
      estimated: false,
    })
  })
})
