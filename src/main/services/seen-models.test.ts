import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types/project'
import { listSeenModels } from './seen-models'

function project(days: { day: string; models: [string, number, number | null][] }[]): Project {
  return {
    sessions: [
      {
        dailyUsage: days.map((d) => ({
          day: d.day,
          models: d.models.map(([model, turnCount, estimatedCost]) => ({
            model,
            family: estimatedCost === null ? 'unknown' : 'sonnet-4-5',
            turnCount,
            estimatedCost,
          })),
        })),
      },
    ],
  } as unknown as Project
}

describe('listSeenModels', () => {
  it('sums responses per model and puts unpriced models first', () => {
    const rows = listSeenModels([
      project([
        {
          day: '2026-10-01',
          models: [
            ['claude-sonnet-4-5', 10, 1.2],
            ['my-gateway/fast', 2, null],
          ],
        },
        { day: '2026-10-03', models: [['claude-sonnet-4-5', 5, 0.4]] },
      ]),
      project([{ day: '(undated)', models: [['my-gateway/fast', 1, null]] }]),
    ])
    expect(rows).toEqual([
      {
        model: 'my-gateway/fast',
        family: 'unknown',
        responses: 3,
        unpricedResponses: 3,
        lastDay: '2026-10-01',
      },
      {
        model: 'claude-sonnet-4-5',
        family: 'sonnet-4-5',
        responses: 15,
        unpricedResponses: 0,
        lastDay: '2026-10-03',
      },
    ])
  })
})
