import { describe, expect, it } from 'vitest'
import { editModelPreference, suggestModelFamily } from './model-preferences'

describe('suggestModelFamily', () => {
  it.each([
    ['my-gateway/claude-sonnet-4-5-latest', 'sonnet-4-5'],
    ['claude-sonnet-4-5-20250929-custom', 'sonnet-4-5'],
    ['litellm/opus-4', 'opus-4'],
    ['corp.claude-opus-4-1:prod', 'opus-4-1'],
    ['eu.anthropic.claude-haiku-4-5-v1:0-proxy', 'haiku-4-5'],
    ['team-claude-3-5-haiku', 'haiku-3-5'],
    ['FABLE-5-1-preview', 'fable-5-1'],
  ])('%s → %s', (model, family) => {
    expect(suggestModelFamily(model)).toBe(family)
  })

  it.each([
    'arn:aws:bedrock:eu-central-1:123:application-inference-profile/abc',
    'prod-deployment',
    'opus-9',
    'sonnet-4-9',
  ])('suggests nothing for %s', (model) => {
    expect(suggestModelFamily(model)).toBeUndefined()
  })
})

describe('editModelPreference', () => {
  it('sets and clears fields, dropping a model left with nothing', () => {
    let prefs = editModelPreference({}, 'gw/fast', (p) => ({ ...p, family: 'haiku-4-5' }))
    prefs = editModelPreference(prefs, 'gw/fast', (p) => ({
      ...p,
      rates: { ...p.rates, output: 4 },
      displayName: '  Fast  ',
    }))
    expect(prefs).toEqual({
      'gw/fast': { family: 'haiku-4-5', rates: { output: 4 }, displayName: 'Fast' },
    })

    prefs = editModelPreference(prefs, 'gw/fast', () => ({ rates: { output: undefined } }))
    expect(prefs).toEqual({})
  })
})
