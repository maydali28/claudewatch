import { describe, expect, it } from 'vitest'
import type { Project, SessionSummary } from '@shared/types'
import { buildBlocks, buildSessionOwnerMap, projectColor } from './timeline-panel'

function makeSummary(id: string, projectId: string, timestamp: string): SessionSummary {
  return {
    id,
    projectId,
    projectPath: `/${projectId}`,
    title: id,
    firstTimestamp: timestamp,
    lastTimestamp: timestamp,
    messageCount: 1,
    parentMessageCount: 1,
    modelsUsed: [],
    unpricedResponses: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheCreation5mTokens: 0,
    totalCacheCreation1hTokens: 0,
    compactionCount: 0,
    totalTokensRemovedByCompaction: 0,
    turnDurations: [],
    estimatedCost: 0,
    hasError: false,
    toolCallCount: 0,
    observability: {
      effortDistribution: { low: 0, medium: 0, high: 0, ultrathink: 0 },
      errorClassifications: [],
      hasIdleZombieGap: false,
      estimatedIdleWasteCost: 0,
      compactionTimestamps: [],
      parallelToolCallCount: 0,
      maxParallelDegree: 0,
      isWorktreeSession: false,
    },
    subagents: [],
    dailyUsage: [],
    diagnostics: {
      malformedLines: 0,
      unreadableChildren: 0,
      negativeCounters: 0,
      conflictCount: 0,
      unpricedResponses: 0,
      incompleteUsageResponses: 0,
      responsesWithoutCompletionSignal: 0,
      reducedConfidenceResponses: 0,
    },
    thinkingTokens: 0,
    recordedEffortDistribution: {},
    serviceTiers: [],
  }
}

/**
 * Fix-round-2, self-disclosed during the sweep (same defect shape as the
 * coordinator's finding A/B): a project merged from several worktree
 * directories (`project-scanner.ts`'s `mergeProjectsByResolvedPath`) has
 * sessions whose own `projectId` is each session's PHYSICAL directory, never
 * the merged survivor id. `buildBlocks` used to look up the display name and
 * hash the swimlane colour straight off `s.projectId`, so a merged project's
 * sessions rendered under inconsistent colours and, for any non-survivor
 * directory, the raw encoded directory string as the "project" name instead
 * of the project's real display name.
 */
describe('buildBlocks — merged project blocks use the owning project, not the physical directory', () => {
  const DATE = '2026-09-10'
  const mainSession = makeSummary('s-main', 'main-dir', `${DATE}T09:00:00.000Z`)
  const worktreeSession = makeSummary('s-worktree', 'alpha-worktree-dir', `${DATE}T11:00:00.000Z`)
  const mergedProject: Project = {
    id: 'main-dir',
    name: 'merged',
    path: '/merged',
    sessions: [mainSession, worktreeSession],
    sessionCount: 2,
    localSkills: [],
    localClaudeMd: null,
  }
  const projectNameMap = { 'main-dir': 'merged' }
  const sessionOwnerMap = buildSessionOwnerMap([mergedProject])

  it('labels a non-survivor session with the merged project’s real name, not its raw physical directory id', () => {
    const blocks = buildBlocks([worktreeSession], projectNameMap, sessionOwnerMap, DATE)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].projectId).toBe('main-dir')
    expect(blocks[0].projectName).toBe('merged')
  })

  it('colours every session of a merged project identically, regardless of which physical directory it lives in', () => {
    const blocks = buildBlocks(
      [mainSession, worktreeSession],
      projectNameMap,
      sessionOwnerMap,
      DATE
    )

    expect(blocks).toHaveLength(2)
    expect(blocks[0].colour).toBe(projectColor('main-dir'))
    expect(blocks[1].colour).toBe(blocks[0].colour)
  })
})
