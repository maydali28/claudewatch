import { describe, expect, it } from 'vitest'
import { COST_ESTIMATE_NOTE, COST_ESTIMATE_NOTE_SHORT } from './copy'

// Guards the two promises the README and website will quote verbatim: that
// this figure is not your bill, and not your plan allowance. A future rewrite
// that drops either promise should fail here first.
describe('COST_ESTIMATE_NOTE', () => {
  it('says this is not your bill', () => {
    expect(COST_ESTIMATE_NOTE).toMatch(/not your bill/)
  })

  it('says this is not your plan allowance', () => {
    expect(COST_ESTIMATE_NOTE).toMatch(/plan allowance/)
  })

  // Paid plans can buy usage credits billed at API rates, Claude Code
  // included, so a subscriber can be charged for tokens.
  it('does not claim subscription usage is never charged per token', () => {
    expect(COST_ESTIMATE_NOTE).not.toMatch(/nothing is charged/)
  })

  it('names usage credits among the reasons the real charge can differ', () => {
    expect(COST_ESTIMATE_NOTE).toMatch(/usage credits/)
  })
})

describe('COST_ESTIMATE_NOTE_SHORT', () => {
  it('says this is not your bill or plan allowance', () => {
    expect(COST_ESTIMATE_NOTE_SHORT).toMatch(/not your bill or plan allowance/)
  })
})
