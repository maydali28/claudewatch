import { describe, expect, it } from 'vitest'
import {
  applyOverrideEdit,
  countOverriddenFields,
  parseRateInput,
  resetFamilyOverrides,
} from './pricing-overrides'

describe('parseRateInput', () => {
  it('treats an empty field as clearing the override', () => {
    expect(parseRateInput('')).toEqual({ kind: 'clear' })
  })

  it('treats a whitespace-only field as clearing the override', () => {
    expect(parseRateInput('   ')).toEqual({ kind: 'clear' })
  })

  it('accepts a non-negative decimal rate', () => {
    expect(parseRateInput('77.25')).toEqual({ kind: 'value', value: 77.25 })
    expect(parseRateInput(' 0 ')).toEqual({ kind: 'value', value: 0 })
  })

  it('rejects a negative rate', () => {
    expect(parseRateInput('-1')).toEqual({ kind: 'invalid', message: 'Use 0 or more' })
  })

  it('rejects text that is not a number, including a number with trailing junk', () => {
    expect(parseRateInput('abc')).toEqual({ kind: 'invalid', message: 'Enter a number' })
    expect(parseRateInput('12abc')).toEqual({ kind: 'invalid', message: 'Enter a number' })
  })
})

describe('applyOverrideEdit', () => {
  it('stores a new override field without touching other families', () => {
    const next = applyOverrideEdit({ 'opus-5': { input: 4 } }, 'fable-5-1', 'input', 77.25, 10)
    expect(next).toEqual({ 'opus-5': { input: 4 }, 'fable-5-1': { input: 77.25 } })
  })

  it('removes a cleared field and keeps the family’s other fields', () => {
    const next = applyOverrideEdit(
      { 'fable-5-1': { input: 77.25, output: 60 } },
      'fable-5-1',
      'input',
      undefined,
      10
    )
    expect(next).toEqual({ 'fable-5-1': { output: 60 } })
  })

  it('drops the family entry when its last field is cleared', () => {
    const next = applyOverrideEdit(
      { 'fable-5-1': { input: 77.25 } },
      'fable-5-1',
      'input',
      undefined,
      10
    )
    expect(next).toEqual({})
    expect('fable-5-1' in next).toBe(false)
  })

  it('treats a value equal to the default rate as no override', () => {
    const next = applyOverrideEdit({ 'fable-5-1': { input: 77.25 } }, 'fable-5-1', 'input', 10, 10)
    expect(next).toEqual({})
  })

  it('does not mutate the map it was given', () => {
    const prev = { 'fable-5-1': { input: 77.25 } }
    applyOverrideEdit(prev, 'fable-5-1', 'input', undefined, 10)
    expect(prev).toEqual({ 'fable-5-1': { input: 77.25 } })
  })
})

describe('resetFamilyOverrides', () => {
  it('removes every override for one family and keeps the others', () => {
    const next = resetFamilyOverrides(
      { 'fable-5-1': { input: 1, output: 2 }, 'opus-5': { input: 3 } },
      'fable-5-1'
    )
    expect(next).toEqual({ 'opus-5': { input: 3 } })
  })
})

describe('countOverriddenFields', () => {
  it('counts the stored fields across all families', () => {
    expect(countOverriddenFields({})).toBe(0)
    expect(
      countOverriddenFields({ 'fable-5-1': { input: 1, output: 2 }, 'opus-5': { input: 3 } })
    ).toBe(3)
  })
})
