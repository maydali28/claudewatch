import { describe, expect, it } from 'vitest'
import { CostAlertTracker, describeCostAlert, todaysCost, type CostedSession } from './cost-alerts'

const NOW = new Date(2026, 9, 7, 15, 0) // 7 Oct 2026, local
const TODAY = '2026-10-07'

const s = (id: string, cost: number, today = cost, title = id): CostedSession => ({
  id,
  projectId: 'p',
  title,
  estimatedCost: cost,
  dailyUsage: [
    { day: '2026-10-06', estimatedCost: cost - today },
    { day: TODAY, estimatedCost: today },
  ],
})

function tracker(now = NOW): CostAlertTracker {
  return new CostAlertTracker(() => now)
}

describe('todaysCost', () => {
  it('sums every session’s usage for the given day only', () => {
    expect(todaysCost([s('a', 10, 4), s('b', 3, 3)], TODAY)).toBe(7)
  })
})

describe('CostAlertTracker — daily budget', () => {
  it('alerts when today’s total passes the budget', () => {
    const t = tracker()
    const a = s('a', 30, 20)
    const b = s('b', 10, 10)
    expect(t.check(a, [a, b], { daily: 25, session: 0 })).toEqual([
      { kind: 'daily', day: TODAY, cost: 30, threshold: 25 },
    ])
  })

  it('stays quiet at or under the budget', () => {
    const a = s('a', 25, 25)
    expect(tracker().check(a, [a], { daily: 25, session: 0 })).toEqual([])
  })

  it('alerts once per day', () => {
    const t = tracker()
    const a = s('a', 30, 30)
    t.check(a, [a], { daily: 25, session: 0 })
    expect(t.check(a, [a], { daily: 25, session: 0 })).toEqual([])
  })

  it('alerts again on a new day', () => {
    let now = NOW
    const t = new CostAlertTracker(() => now)
    const a = s('a', 30, 30)
    t.check(a, [a], { daily: 25, session: 0 })
    now = new Date(2026, 9, 8, 9, 0)
    const b: CostedSession = { ...a, dailyUsage: [{ day: '2026-10-08', estimatedCost: 26 }] }
    expect(t.check(b, [b], { daily: 25, session: 0 })).toEqual([
      { kind: 'daily', day: '2026-10-08', cost: 26, threshold: 25 },
    ])
  })

  it('is off when the budget is 0 or unset', () => {
    const a = s('a', 30, 30)
    expect(tracker().check(a, [a], { daily: 0, session: 0 })).toEqual([])
    expect(tracker().check(a, [a], {})).toEqual([])
  })
})

describe('CostAlertTracker — session cost', () => {
  it('alerts when the updated session passes the limit', () => {
    const a = s('a', 12.1, 0, 'Secrets alerts testing')
    expect(tracker().check(a, [a], { daily: 0, session: 10 })).toEqual([
      {
        kind: 'session',
        sessionId: 'a',
        projectId: 'p',
        title: 'Secrets alerts testing',
        cost: 12.1,
        threshold: 10,
      },
    ])
  })

  it('alerts once per session', () => {
    const t = tracker()
    const a = s('a', 12, 0)
    t.check(a, [a], { session: 10 })
    expect(t.check({ ...a, estimatedCost: 15 }, [a], { session: 10 })).toEqual([])
  })

  it('checks only the session that changed', () => {
    const a = s('a', 1, 0)
    const b = s('b', 50, 0)
    expect(tracker().check(a, [a, b], { session: 10 })).toEqual([])
  })

  it('can raise both alerts from one update', () => {
    const a = s('a', 40, 40)
    expect(
      tracker()
        .check(a, [a], { daily: 25, session: 10 })
        .map((x) => x.kind)
    ).toEqual(['daily', 'session'])
  })
})

describe('CostAlertTracker — baseline at startup', () => {
  it('does not alert for what was already over when the app started', () => {
    const t = tracker()
    const a = s('a', 40, 40)
    t.baseline([a], { daily: 25, session: 10 })
    expect(t.check(a, [a], { daily: 25, session: 10 })).toEqual([])
  })

  it('still alerts for sessions and budgets that cross later', () => {
    const t = tracker()
    const a = s('a', 5, 5)
    t.baseline([a], { daily: 25, session: 10 })
    const later = s('a', 30, 30)
    expect(t.check(later, [later], { daily: 25, session: 10 }).map((x) => x.kind)).toEqual([
      'daily',
      'session',
    ])
  })
})

describe('describeCostAlert', () => {
  it('words a daily alert as an estimate', () => {
    expect(describeCostAlert({ kind: 'daily', day: TODAY, cost: 27.4, threshold: 25 })).toEqual({
      title: 'Daily budget passed',
      body: 'Estimated spend today is $27.40, over your $25.00 daily budget.',
    })
  })

  it('names the session in a session alert', () => {
    expect(
      describeCostAlert({
        kind: 'session',
        sessionId: 'a',
        projectId: 'p',
        title: 'Secrets alerts testing',
        cost: 12.1,
        threshold: 10,
      })
    ).toEqual({
      title: 'Session cost limit passed',
      body: '“Secrets alerts testing” has an estimated cost of $12.10, over your $10.00 limit.',
    })
  })
})
