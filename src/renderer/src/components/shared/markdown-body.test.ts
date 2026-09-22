import { describe, expect, it } from 'vitest'
import { lineCount } from './markdown-body-rules'

describe('lineCount', () => {
  it('counts the lines of a body', () => {
    expect(lineCount('one\ntwo\nthree')).toBe(3)
  })

  it('is one for a single line without a newline', () => {
    expect(lineCount('just this')).toBe(1)
  })

  it('does not count a trailing newline as an extra line', () => {
    expect(lineCount('one\ntwo\n')).toBe(2)
  })

  it('is zero for an empty body', () => {
    expect(lineCount('')).toBe(0)
  })
})
