import { describe, expect, it } from 'vitest'
import { getModelFamily } from './models'
import type { ModelFamily } from '@shared/types/pricing'

/**
 * Every raw model ID Claude Code can write into a transcript, and the family it
 * must resolve to. A missing entry here is how Opus 5 came to be priced at
 * Sonnet rates and dropped from every model chart.
 */
describe('getModelFamily — current models', () => {
  const cases: Array<[string, ModelFamily]> = [
    ['claude-fable-5-1', 'fable-5-1'],
    ['claude-mythos-5-1', 'mythos-5-1'],
    ['claude-fable-5', 'fable-5'],
    ['claude-mythos-5', 'mythos-5'],
    ['claude-opus-5', 'opus-5'],
    ['claude-sonnet-5', 'sonnet-5'],
    ['claude-opus-4-8', 'opus-4-8'],
    ['claude-opus-4-7', 'opus-4-7'],
    ['claude-opus-4-6', 'opus-4-6'],
    ['claude-sonnet-4-6', 'sonnet-4-6'],
    ['claude-haiku-4-5', 'haiku-4-5'],
  ]

  it.each(cases)('%s resolves to %s', (raw, expected) => {
    expect(getModelFamily(raw)).toBe(expected)
  })
})

describe('getModelFamily — dated snapshots', () => {
  const cases: Array<[string, ModelFamily]> = [
    ['claude-opus-4-5-20251101', 'opus-4-5'],
    ['claude-opus-4-20250514', 'opus-4'],
    ['claude-sonnet-4-20250514', 'sonnet-4'],
    ['claude-sonnet-4-5-20250929', 'sonnet-4-5'],
  ]

  it.each(cases)('%s resolves to %s', (raw, expected) => {
    expect(getModelFamily(raw)).toBe(expected)
  })
})

/**
 * Claude Code can run against Bedrock and Vertex (CLAUDE_CODE_USE_BEDROCK /
 * CLAUDE_CODE_USE_VERTEX), which decorate the model ID with a provider prefix
 * and, on Bedrock, an inference-profile suffix. Resolving those to `unknown`
 * would report the whole session as unpriced.
 */
describe('getModelFamily — provider-decorated IDs', () => {
  const cases: Array<[string, ModelFamily]> = [
    ['anthropic.claude-opus-5', 'opus-5'],
    ['us.anthropic.claude-sonnet-5', 'sonnet-5'],
    ['eu.anthropic.claude-opus-4-6', 'opus-4-6'],
    ['apac.anthropic.claude-sonnet-4-6', 'sonnet-4-6'],
    ['claude-sonnet-4-5-20250929-v1:0', 'sonnet-4-5'],
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'sonnet-4-5'],
    ['claude-opus-4-5@20251101', 'opus-4-5'],
  ]

  it.each(cases)('%s resolves to %s', (raw, expected) => {
    expect(getModelFamily(raw)).toBe(expected)
  })
})

describe('getModelFamily — zero-minor aliases', () => {
  const cases: Array<[string, ModelFamily]> = [
    ['claude-opus-4-0', 'opus-4'],
    ['claude-sonnet-4-0', 'sonnet-4'],
  ]

  it.each(cases)('%s resolves to %s', (raw, expected) => {
    expect(getModelFamily(raw)).toBe(expected)
  })
})

describe('getModelFamily — legacy version-before-family IDs', () => {
  const cases: Array<[string, ModelFamily]> = [
    ['claude-3-7-sonnet-20250219', 'sonnet-3-7'],
    ['claude-3-5-sonnet-20241022', 'sonnet-3-5'],
    ['claude-3-5-haiku-20241022', 'haiku-3-5'],
    ['claude-3-opus-20240229', 'opus-3'],
    ['claude-3-haiku-20240307', 'haiku-3'],
  ]

  it.each(cases)('%s resolves to %s', (raw, expected) => {
    expect(getModelFamily(raw)).toBe(expected)
  })
})

/**
 * Analytics hands charts a resolved family (`opus-5`), and those charts resolve
 * it again to pick a label and colour. Resolution must therefore be idempotent
 * — the substring matcher was accidentally, and an exact registry is not unless
 * families are registered as their own keys. Without this every model chart
 * falls back to the generic "Claude" label.
 */
describe('getModelFamily — resolving a family is idempotent', () => {
  const families: ModelFamily[] = [
    'fable-5-1',
    'mythos-5-1',
    'fable-5',
    'mythos-5',
    'opus-5',
    'opus-4-8',
    'opus-4-7',
    'opus-4-6',
    'opus-4-5',
    'opus-4-1',
    'opus-4',
    'opus-3',
    'sonnet-5',
    'sonnet-4-6',
    'sonnet-4-5',
    'sonnet-4',
    'sonnet-3-7',
    'sonnet-3-5',
    'haiku-4-5',
    'haiku-3-5',
    'haiku-3',
    'unknown',
  ]

  it.each(families)('%s resolves to itself', (family) => {
    expect(getModelFamily(family)).toBe(family)
  })

  it('resolving twice matches resolving once', () => {
    const once = getModelFamily('claude-fable-5-1')
    expect(getModelFamily(once)).toBe(once)
  })
})

describe('getModelFamily — case insensitivity', () => {
  it('resolves an upper-case ID', () => {
    expect(getModelFamily('CLAUDE-OPUS-5')).toBe('opus-5')
  })
})

/**
 * An unrecognised model must never fall through to an older family. Today
 * `claude-opus-4-9` matches the broad `includes('opus-4')` rule and would bill
 * silently at Opus 4 rates.
 */
describe('getModelFamily — unrecognised models resolve to unknown, never an older family', () => {
  const cases: string[] = [
    'claude-opus-4-9',
    'claude-sonnet-4-9',
    'claude-haiku-4-9',
    'claude-opus-6',
    'claude-sonnet-6',
    'claude-fable-6',
    'claude-quartz-5',
  ]

  it.each(cases)('%s resolves to unknown', (raw) => {
    expect(getModelFamily(raw)).toBe('unknown')
  })
})

/**
 * Bare aliases appear in transcripts as Agent-tool arguments (`tool_use.input`)
 * and in Claude Code configuration. They name a tier, not a billed model, so
 * they must never resolve to a concrete family and a rate — the alias that was
 * current when a transcript was written is unknowable later.
 */
describe('getModelFamily — aliases are not billable identities', () => {
  const cases: string[] = ['sonnet', 'opus', 'haiku', 'fable']

  it.each(cases)('alias %s resolves to unknown', (raw) => {
    expect(getModelFamily(raw)).toBe('unknown')
  })
})

describe('getModelFamily — absent and synthetic models', () => {
  it('resolves undefined to unknown', () => {
    expect(getModelFamily(undefined)).toBe('unknown')
  })

  it('resolves null to unknown', () => {
    expect(getModelFamily(null)).toBe('unknown')
  })

  it('resolves an empty string to unknown', () => {
    expect(getModelFamily('')).toBe('unknown')
  })

  it('resolves the synthetic marker to unknown', () => {
    expect(getModelFamily('<synthetic>')).toBe('unknown')
  })
})
