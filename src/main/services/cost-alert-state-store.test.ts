import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createCostAlertStateStore } from './cost-alert-state-store'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-alert-state-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('createCostAlertStateStore', () => {
  it('starts empty when there is no file', () => {
    expect(createCostAlertStateStore(dir).load()).toEqual({ dailyFiredOn: null, sessionsFired: [] })
  })

  it('keeps what was saved for the next launch', () => {
    createCostAlertStateStore(dir).save({ dailyFiredOn: '2026-10-08', sessionsFired: ['a', 'b'] })
    expect(createCostAlertStateStore(dir).load()).toEqual({
      dailyFiredOn: '2026-10-08',
      sessionsFired: ['a', 'b'],
    })
  })

  it('starts empty rather than failing on an unreadable or foreign file', () => {
    fs.writeFileSync(path.join(dir, 'cost-alert-state.json'), '{not json')
    expect(createCostAlertStateStore(dir).load()).toEqual({ dailyFiredOn: null, sessionsFired: [] })
    fs.writeFileSync(path.join(dir, 'cost-alert-state.json'), JSON.stringify({ version: 99 }))
    expect(createCostAlertStateStore(dir).load()).toEqual({ dailyFiredOn: null, sessionsFired: [] })
  })
})
