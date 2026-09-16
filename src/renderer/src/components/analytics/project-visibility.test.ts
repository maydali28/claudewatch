import { describe, expect, it } from 'vitest'
import type { ProjectCost } from '@shared/types/analytics'
import { isProjectVisibleInRange } from './project-visibility'

function statsFor(overrides: Partial<ProjectCost>): ProjectCost {
  return {
    id: 'p1',
    projectId: 'p1',
    projectName: 'proj',
    totalCost: 0,
    totalTokens: 0,
    sessionCount: 0,
    messageCount: 0,
    ...overrides,
  }
}

const NOT_SEARCHING = ''
const NOTHING_SELECTED = null

describe('isProjectVisibleInRange', () => {
  it('keeps a project with activity in the range', () => {
    const project = { id: 'p1', name: 'alpha' }
    const stats = statsFor({ messageCount: 5 })

    expect(isProjectVisibleInRange(project, stats, NOTHING_SELECTED, NOT_SEARCHING)).toBe(true)
  })

  it('drops a project with no activity in the range', () => {
    const project = { id: 'p1', name: 'alpha' }
    const stats = statsFor({ messageCount: 0 })

    expect(isProjectVisibleInRange(project, stats, NOTHING_SELECTED, NOT_SEARCHING)).toBe(false)
  })

  it('drops a project absent from the range entirely (no stats row at all)', () => {
    const project = { id: 'p1', name: 'alpha' }

    expect(isProjectVisibleInRange(project, undefined, NOTHING_SELECTED, NOT_SEARCHING)).toBe(false)
  })

  it('keeps the currently selected project even when idle', () => {
    const project = { id: 'p1', name: 'alpha' }
    const stats = statsFor({ messageCount: 0 })

    expect(isProjectVisibleInRange(project, stats, 'p1', NOT_SEARCHING)).toBe(true)
  })

  it('keeps an idle project whose name matches an active search', () => {
    const project = { id: 'p1', name: 'alpha' }
    const stats = statsFor({ messageCount: 0 })

    expect(isProjectVisibleInRange(project, stats, NOTHING_SELECTED, 'alp')).toBe(true)
  })

  it('drops a project that fails to match an active search, even if selected', () => {
    // Pre-existing search semantics: search filters everything, selection
    // only overrides idleness, not a name mismatch.
    const project = { id: 'p1', name: 'alpha' }
    const stats = statsFor({ messageCount: 5 })

    expect(isProjectVisibleInRange(project, stats, 'p1', 'zzz')).toBe(false)
  })

  it('keeps a project with messages but zero cost — cost is not the activity signal', () => {
    const project = { id: 'p1', name: 'alpha' }
    const stats = statsFor({ messageCount: 3, totalCost: 0 })

    expect(isProjectVisibleInRange(project, stats, NOTHING_SELECTED, NOT_SEARCHING)).toBe(true)
  })
})
