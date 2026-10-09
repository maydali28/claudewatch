import { describe, expect, it } from 'vitest'
import { dailyBudgetNotice, sessionLimitNotice } from './cost-limits'

describe('dailyBudgetNotice', () => {
  it('says so once today’s spend passes the budget', () => {
    expect(dailyBudgetNotice(28.12, { daily: 25, session: 0 })).toBe(
      'Over daily budget · $28.12 of $25.00'
    )
  })

  it('says nothing at or under the budget, or when the budget is off', () => {
    expect(dailyBudgetNotice(25, { daily: 25, session: 0 })).toBeNull()
    expect(dailyBudgetNotice(99, { daily: 0, session: 10 })).toBeNull()
  })
})

describe('sessionLimitNotice', () => {
  it('names the limit a session passed', () => {
    expect(sessionLimitNotice(12.4, { daily: 0, session: 10 })).toBe(
      'Over your $10.00 session limit'
    )
  })

  it('says nothing at or under the limit, or when the limit is off', () => {
    expect(sessionLimitNotice(10, { daily: 0, session: 10 })).toBeNull()
    expect(sessionLimitNotice(50, { daily: 25, session: 0 })).toBeNull()
  })
})
