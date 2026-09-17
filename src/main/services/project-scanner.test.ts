import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Project } from '@shared/types/project'
import type { SessionSummary } from '@shared/types/session'
import { ANTHROPIC_PRICING } from '@shared/constants/pricing'

// project-scanner.ts pulls in the full session-parser → metadata-parser
// chain, which imports '@main/lib/logger'; that module calls electron-log's
// initialize() at import time, which throws outside a real Electron main
// context (see autostart.test.ts for the same workaround). Only
// `sortProjectsByLatestSession` — a pure array sort — is under test here.
// vi.mock is hoisted above these imports, so the static import below resolves
// against the mock rather than the real logger module.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  rootLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Used only by the `scanProjects — the merge is actually wired into the
// scan` describe block below, to redirect `getClaudeDir()`
// (`@main/lib/claude-paths.ts`'s `path.join(os.homedir(), '.claude')`) at a
// real fixture directory instead of the real `~/.claude`. `vi.spyOn(os,
// 'homedir')` can't do this — vitest's ESM transform makes the `os` module
// namespace non-configurable ("Cannot redefine property: homedir") — so the
// whole module is mocked instead, keeping every other `os` export real via
// `importOriginal`. The mock factory is hoisted above this file's imports and
// evaluated once, before any test runs, so the redirect target has to be a
// mutable box (`vi.hoisted`) a test can set later rather than a plain
// variable closed over by value.
const fixtureHome = vi.hoisted(() => ({ path: '' }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  return { ...actual, homedir: () => fixtureHome.path }
})

import {
  sortProjectsByLatestSession,
  sortSessionsByLatestTimestamp,
  mergeProjectsByResolvedPath,
  scanProjects,
} from './project-scanner'
import type { ScannedProject } from './project-scanner'
import { configureMetadataCacheDir } from './metadata-cache'
import { resetClaudeDirCache } from '@main/lib/claude-paths'

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1',
    projectId: 'proj',
    projectPath: '/proj',
    title: 'session',
    firstTimestamp: '2026-01-01T00:00:00.000Z',
    lastTimestamp: '2026-01-01T00:00:00.000Z',
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
      pricingModifierResponses: 0,
      serverToolRequests: 0,
    },
    thinkingTokens: 0,
    recordedEffortDistribution: {},
    turnOpen: false,
    serviceTiers: [],
    ...overrides,
  }
}

function makeProject(id: string, lastTimestamp: string): Project {
  return {
    id,
    name: id,
    path: `/${id}`,
    pathResolved: true,
    // getValidSortedSessionForProject already sorts each project's own
    // sessions most-recent-first, so index 0 is always the project's latest.
    sessions: [makeSummary({ lastTimestamp })],
    sessionCount: 1,
    localSkills: [],
    localClaudeMd: null,
  }
}

/** Like `makeProject`, but with an explicit `path` and session list — used by
 * the `mergeProjectsByResolvedPath` tests below, where several `Project`s
 * sharing one resolved `path` (or deliberately NOT sharing one) is the whole
 * point. */
function makeProjectAt(id: string, path: string, sessions: SessionSummary[]): Project {
  return {
    id,
    name: id,
    path,
    pathResolved: true,
    sessions,
    sessionCount: sessions.length,
    localSkills: [],
    localClaudeMd: null,
  }
}

function scanned(project: Project, resolved: boolean): ScannedProject {
  return { project, resolved }
}

/**
 * `lastTimestamp` is raw transcript text with no guaranteed `Z` suffix.
 * `sortProjectsByLatestSession` used to order the sidebar's project list with
 * `.localeCompare`, which sorted by digits instead of by the instant those
 * digits name — the same defect fixed in the accounting projection's "latest
 * model" badge and the Overview table's "Last active" sort.
 */
describe('sortProjectsByLatestSession', () => {
  it('orders correctly when timestamps carry mixed offsets', () => {
    // '+02:00' names the instant 2026-09-13T22:30:00Z — earlier than 'b'
    // below — but as raw text it sorts AFTER 'b' because '14' > '13' in the
    // date portion, which is exactly what a lexical comparison gets backwards.
    const a = makeProject('a', '2026-09-14T00:30:00+02:00')
    const b = makeProject('b', '2026-09-13T23:00:00Z')

    expect(sortProjectsByLatestSession([a, b]).map((p) => p.id)).toEqual(['b', 'a'])
    expect(sortProjectsByLatestSession([b, a]).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('all-Z corpus orders correctly (regression pin)', () => {
    const a = makeProject('a', '2026-09-09T00:00:00.000Z')
    const b = makeProject('b', '2026-09-08T00:00:00.000Z')

    expect(sortProjectsByLatestSession([b, a]).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('sorts a project with an unparseable timestamp as least recent, never first by accident', () => {
    // Rule: an unparseable timestamp is never evidence that a project is
    // more recently active than one with a real timestamp, so it always
    // sorts last in this most-recent-first list.
    const a = makeProject('a', '2026-09-09T00:00:00.000Z')
    const garbage = makeProject('garbage', 'not-a-timestamp')
    const b = makeProject('b', '2026-09-08T00:00:00.000Z')

    expect(sortProjectsByLatestSession([garbage, a, b]).map((p) => p.id)).toEqual([
      'a',
      'b',
      'garbage',
    ])
  })

  it('treats a project with no sessions the same as an unparseable timestamp', () => {
    const a = makeProject('a', '2026-09-09T00:00:00.000Z')
    const empty: Project = { ...makeProject('empty', ''), sessions: [] }

    expect(sortProjectsByLatestSession([empty, a]).map((p) => p.id)).toEqual(['a', 'empty'])
  })

  it('does not mutate the input array', () => {
    const a = makeProject('a', '2026-09-08T00:00:00.000Z')
    const b = makeProject('b', '2026-09-09T00:00:00.000Z')
    const input = [a, b]

    sortProjectsByLatestSession(input)

    expect(input.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

/**
 * `getValidSortedSessionForProject` (the full-scan path, not under test here
 * since it touches disk) orders each project's OWN sessions most-recent-first
 * via this pure helper before `scanProjects` returns. Its `!== ''` filter on
 * the caller's side only rejects an absent `lastTimestamp`, not a malformed
 * non-empty one, so this is the session-level twin of
 * `sortProjectsByLatestSession` above — same defect class, same file, missed
 * by that earlier fix.
 */
describe('sortSessionsByLatestTimestamp', () => {
  it('orders correctly when timestamps carry mixed offsets', () => {
    const a = makeSummary({ id: 'a', lastTimestamp: '2026-09-14T00:30:00+02:00' })
    const b = makeSummary({ id: 'b', lastTimestamp: '2026-09-13T23:00:00Z' })

    expect(sortSessionsByLatestTimestamp([a, b]).map((s) => s.id)).toEqual(['b', 'a'])
    expect(sortSessionsByLatestTimestamp([b, a]).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('sorts a session with an unparseable timestamp as least recent, never first by accident', () => {
    const newest = makeSummary({ id: 'newest', lastTimestamp: '2026-09-09T00:00:00.000Z' })
    const garbage = makeSummary({ id: 'garbage', lastTimestamp: 'not-a-timestamp' })
    const oldest = makeSummary({ id: 'oldest', lastTimestamp: '2026-09-08T00:00:00.000Z' })

    // Deliberately NOT already in the correct order, so a comparator that
    // returns NaN and leaves the input untouched wouldn't accidentally look
    // right.
    expect(sortSessionsByLatestTimestamp([garbage, oldest, newest]).map((s) => s.id)).toEqual([
      'newest',
      'oldest',
      'garbage',
    ])
  })

  it('does not mutate the input array', () => {
    const a = makeSummary({ id: 'a', lastTimestamp: '2026-09-08T00:00:00.000Z' })
    const b = makeSummary({ id: 'b', lastTimestamp: '2026-09-09T00:00:00.000Z' })
    const input = [a, b]

    sortSessionsByLatestTimestamp(input)

    expect(input.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

/**
 * A git worktree gets its own `~/.claude/projects/<encoded-cwd>` directory
 * even though it is the same working directory as the main checkout, so
 * `scanProjects` can see several directories that all resolved to one real
 * `cwd` — see task-6-brief.md. `mergeProjectsByResolvedPath` collapses those
 * into one `Project` after `getProjectDetails` has resolved each directory's
 * real path, which is exactly where the resolved/unresolved distinction
 * (ruling 5) is still available.
 */
describe('mergeProjectsByResolvedPath', () => {
  const cwd = '/Users/mo/dash/claudewatch'
  const main = makeProjectAt('-Users-mo-dash-claudewatch', cwd, [
    makeSummary({ id: 'main-1', lastTimestamp: '2026-09-10T00:00:00.000Z' }),
  ])
  const worktreeRelease = makeProjectAt(
    '-Users-mo-dash-claudewatch--claude-worktrees-release-automation',
    cwd,
    [makeSummary({ id: 'release-1', lastTimestamp: '2026-09-12T00:00:00.000Z' })]
  )
  const worktreeAccounting = makeProjectAt(
    '-Users-mo-dash-claudewatch--claude-worktrees-token-accounting-redesign',
    cwd,
    [makeSummary({ id: 'accounting-1', lastTimestamp: '2026-09-11T00:00:00.000Z' })]
  )

  it('merges directories that resolve to the same real cwd into one project', () => {
    const merged = mergeProjectsByResolvedPath([
      scanned(main, true),
      scanned(worktreeRelease, true),
      scanned(worktreeAccounting, true),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].path).toBe(cwd)
  })

  it('unions and re-sorts sessions from every merged directory; sessionCount matches', () => {
    const merged = mergeProjectsByResolvedPath([
      scanned(main, true),
      scanned(worktreeRelease, true),
      scanned(worktreeAccounting, true),
    ])

    expect(merged[0].sessionCount).toBe(3)
    // Most-recent-first across the union, via the existing time-based
    // comparator — not the order the three directories happened to arrive in.
    expect(merged[0].sessions.map((s) => s.id)).toEqual(['release-1', 'accounting-1', 'main-1'])
  })

  it('picks the lexicographically smallest id as the deterministic survivor, regardless of input order', () => {
    const forward = mergeProjectsByResolvedPath([
      scanned(main, true),
      scanned(worktreeRelease, true),
      scanned(worktreeAccounting, true),
    ])
    const reversed = mergeProjectsByResolvedPath([
      scanned(worktreeAccounting, true),
      scanned(worktreeRelease, true),
      scanned(main, true),
    ])

    expect(forward[0].id).toBe('-Users-mo-dash-claudewatch')
    expect(reversed[0].id).toBe(forward[0].id)
  })

  it('keeps two different real cwds separate even when they share a trailing path segment', () => {
    // "/a/web" and "/b/web" both display as "web" but are not the same
    // project — merging must go by the resolved path, never the name.
    const projectA = {
      ...makeProjectAt('-a-web', '/a/web', [makeSummary({ id: 's-a' })]),
      name: 'web',
    }
    const projectB = {
      ...makeProjectAt('-b-web', '/b/web', [makeSummary({ id: 's-b' })]),
      name: 'web',
    }

    const merged = mergeProjectsByResolvedPath([scanned(projectA, true), scanned(projectB, true)])

    expect(merged).toHaveLength(2)
    expect(merged.map((p) => p.id).sort()).toEqual(['-a-web', '-b-web'])
  })

  it('never merges unresolved projects with each other, even when decodeProjectId collapses them to the same fallback path', () => {
    // Simulates decodeProjectId's lossiness: two different encoded directory
    // names that happen to decode to the identical (wrong) path.
    const fallbackPath = '/mohamedali/may'
    const projectA = makeProjectAt('-mohamedali-may', fallbackPath, [makeSummary({ id: 's-a' })])
    const projectB = makeProjectAt('-mohamedali.may', fallbackPath, [makeSummary({ id: 's-b' })])

    const merged = mergeProjectsByResolvedPath([scanned(projectA, false), scanned(projectB, false)])

    expect(merged).toHaveLength(2)
    expect(merged.map((p) => p.id).sort()).toEqual(['-mohamedali-may', '-mohamedali.may'])
  })

  it('never merges a resolved project with an unresolved one even if their paths match', () => {
    const sharedPath = '/Users/mo/dash/claudewatch'
    const resolvedProject = makeProjectAt('-Users-mo-dash-claudewatch', sharedPath, [
      makeSummary({ id: 's-resolved' }),
    ])
    const unresolvedProject = makeProjectAt('-some-other-dir', sharedPath, [
      makeSummary({ id: 's-unresolved' }),
    ])

    const merged = mergeProjectsByResolvedPath([
      scanned(resolvedProject, true),
      scanned(unresolvedProject, false),
    ])

    expect(merged).toHaveLength(2)
  })

  it('unions localSkills across the merged group, deduped by skill id', () => {
    const skillFoo = {
      id: 'foo',
      name: 'foo',
      displayName: 'Foo',
      metadata: {},
      body: 'body-foo',
      sizeBytes: 10,
    }
    const skillBar = {
      id: 'bar',
      name: 'bar',
      displayName: 'Bar',
      metadata: {},
      body: 'body-bar',
      sizeBytes: 10,
    }
    const withFoo = {
      ...makeProjectAt('-main', cwd, [makeSummary({ id: 's1' })]),
      localSkills: [skillFoo],
    }
    const withBoth = {
      ...makeProjectAt('-worktree', cwd, [makeSummary({ id: 's2' })]),
      localSkills: [skillFoo, skillBar],
    }

    const merged = mergeProjectsByResolvedPath([scanned(withFoo, true), scanned(withBoth, true)])

    expect(merged[0].localSkills.map((s) => s.id).sort()).toEqual(['bar', 'foo'])
  })

  it('keeps the first non-null localClaudeMd in the merged group, tolerating a failed read on another member', () => {
    const withoutClaudeMd = {
      ...makeProjectAt('-main', cwd, [makeSummary({ id: 's1' })]),
      localClaudeMd: null,
    }
    const withClaudeMd = {
      ...makeProjectAt('-worktree', cwd, [makeSummary({ id: 's2' })]),
      localClaudeMd: '# notes',
    }

    const merged = mergeProjectsByResolvedPath([
      scanned(withoutClaudeMd, true),
      scanned(withClaudeMd, true),
    ])

    expect(merged[0].localClaudeMd).toBe('# notes')
  })

  it('passes a lone project through unchanged (same reference) when nothing else shares its resolved path', () => {
    const lone = makeProjectAt('-Users-mo-dash-claudewatch', cwd, [makeSummary({ id: 's1' })])

    const merged = mergeProjectsByResolvedPath([scanned(lone, true)])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(lone)
  })

  /**
   * Fix-round-1 finding 8: the survivor id must stay stable not just across
   * scan order but across a NEW worktree sibling appearing later — a fresh
   * worktree whose own name happens to sort first must not steal the
   * survivor id out from under a user who has the project selected.
   *
   * A Claude Code worktree's directory id is always the checkout's own id
   * with a literal `--claude-worktrees-<name>` suffix appended (verified
   * against this repo's real `~/.claude/projects/` entries), so it is always
   * a strict superstring of the checkout's id — and a string that is a
   * strict prefix of another always sorts first lexicographically,
   * regardless of what follows the prefix. That means the checkout's id can
   * never stop being the smallest of the group no matter how the new
   * worktree is named, so the existing lexicographic-sort survivor rule is
   * already stable against this — this test pins that property rather than
   * assuming it.
   */
  it('a new worktree sibling never flips the survivor, whatever its own name sorts as', () => {
    const checkout = '-Users-mo-dash-claudewatch'
    const worktreeZ = `${checkout}--claude-worktrees-zzz-late-worktree`
    const worktreeA = `${checkout}--claude-worktrees-aaa-earlier-sounding-worktree`

    const checkoutProject = makeProjectAt(checkout, cwd, [makeSummary({ id: 's1' })])
    const worktreeZProject = makeProjectAt(worktreeZ, cwd, [makeSummary({ id: 's2' })])
    const worktreeAProject = makeProjectAt(worktreeA, cwd, [makeSummary({ id: 's3' })])

    const beforeNewSibling = mergeProjectsByResolvedPath([
      scanned(checkoutProject, true),
      scanned(worktreeZProject, true),
    ])
    const afterNewSiblingArrives = mergeProjectsByResolvedPath([
      scanned(checkoutProject, true),
      scanned(worktreeZProject, true),
      scanned(worktreeAProject, true),
    ])

    expect(beforeNewSibling[0].id).toBe(checkout)
    expect(afterNewSiblingArrives[0].id).toBe(checkout)
  })
})

/**
 * Fix-round-1 finding 3: every `mergeProjectsByResolvedPath` behaviour above
 * is fully covered in isolation, but nothing proved `scanProjects` itself
 * actually CALLS it — silently reverting that one call site to
 * `scanned.map((s) => s.project)` left the whole suite green. This drives
 * the real, exported `scanProjects` end-to-end against an on-disk fixture
 * shaped exactly like the reported defect (a main checkout plus two
 * `.claude/worktrees/`-style directories, all three recording the same
 * `cwd`), so a regression to the unwired call is caught here rather than
 * only in the pure-function tests above.
 *
 * `os.homedir()` is redirected (not `@main/lib/claude-paths` mocked) so
 * `getClaudeDir()`/`getProjectsDirPath()` run for real against a temp
 * directory — this is the same `os` module `claude-paths.ts` itself imports,
 * so the redirect is real, not a stand-in for the code under test.
 */
describe('scanProjects — the merge is actually wired into the scan', () => {
  beforeEach(() => {
    // These tests point `os.homedir()` at a fresh temp tree; the first
    // `getClaudeDir()` of the file would otherwise still be cached from
    // whatever resolved before it.
    resetClaudeDirCache()
  })
  afterEach(() => {
    fixtureHome.path = ''
    // getClaudeDir() caches its first resolution; without this the second
    // test would still scan the first test's (deleted) home.
    resetClaudeDirCache()
  })

  it('collapses three on-disk worktree-style directories sharing one cwd into a single scanned project', async () => {
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scanner-wiring-home-'))
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scanner-wiring-cache-'))

    try {
      fixtureHome.path = homeRoot
      // Without this, the disk-cache's background flush (fired ~1s after
      // setCachedSummary, well after this test's own assertions run) throws
      // "Metadata cache directory not configured" as an unhandled error.
      configureMetadataCacheDir(cacheDir)

      const projectsDir = path.join(homeRoot, '.claude', 'projects')
      fs.mkdirSync(projectsDir, { recursive: true })

      const fixtureCwd = '/fixture/one-project'
      const dirNames = [
        '-fixture-one-project',
        '-fixture-one-project--claude-worktrees-alpha',
        '-fixture-one-project--claude-worktrees-beta',
      ]
      dirNames.forEach((dirName, i) => {
        const projectDir = path.join(projectsDir, dirName)
        fs.mkdirSync(projectDir, { recursive: true })
        const records = [
          {
            type: 'user',
            uuid: `u-${i}`,
            cwd: fixtureCwd,
            timestamp: `2026-09-1${i}T09:59:00.000Z`,
            message: { role: 'user', content: 'hi' },
          },
          {
            type: 'assistant',
            uuid: `a-${i}`,
            timestamp: `2026-09-1${i}T10:00:00.000Z`,
            message: {
              id: `msg-${i}`,
              role: 'assistant',
              model: 'claude-opus-5',
              content: [{ type: 'text', text: 'hello' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          },
        ]
        fs.writeFileSync(
          path.join(projectDir, `session-${i}.jsonl`),
          records.map((r) => JSON.stringify(r)).join('\n') + '\n'
        )
      })

      const { projects } = await scanProjects(ANTHROPIC_PRICING)

      const named = projects.filter((p) => p.name === 'one-project')
      expect(named).toHaveLength(1)
      expect(named[0].sessionCount).toBe(3)
      expect(named[0].pathResolved).toBe(true)
    } finally {
      fs.rmSync(homeRoot, { recursive: true, force: true })
      fs.rmSync(cacheDir, { recursive: true, force: true })
    }
  })
  it('marks a project resolved from a transcript cwd as pathResolved and a decoded-only one as not', async () => {
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scanner-resolved-home-'))
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scanner-resolved-cache-'))

    try {
      fixtureHome.path = homeRoot
      configureMetadataCacheDir(cacheDir)
      const projectsDir = path.join(homeRoot, '.claude', 'projects')

      const writeSession = (dirName: string, cwd: string | undefined): void => {
        const projectDir = path.join(projectsDir, dirName)
        fs.mkdirSync(projectDir, { recursive: true })
        const records = [
          {
            type: 'user',
            uuid: `u-${dirName}`,
            ...(cwd ? { cwd } : {}),
            timestamp: '2026-09-10T09:59:00.000Z',
            message: { role: 'user', content: 'hi' },
          },
          {
            type: 'assistant',
            uuid: `a-${dirName}`,
            timestamp: '2026-09-10T10:00:00.000Z',
            message: {
              id: `msg-${dirName}`,
              role: 'assistant',
              model: 'claude-opus-5',
              content: [{ type: 'text', text: 'hello' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          },
        ]
        fs.writeFileSync(
          path.join(projectDir, 'session.jsonl'),
          records.map((r) => JSON.stringify(r)).join('\n') + '\n'
        )
      }

      writeSession('-fixture-with-cwd', '/fixture/with-cwd')
      writeSession('-fixture-decoded-only', undefined)

      const { projects } = await scanProjects(ANTHROPIC_PRICING)
      const withCwd = projects.find((p) => p.id === '-fixture-with-cwd')
      const decodedOnly = projects.find((p) => p.id === '-fixture-decoded-only')

      expect(withCwd?.path).toBe('/fixture/with-cwd')
      expect(withCwd?.pathResolved).toBe(true)
      expect(decodedOnly).toBeDefined()
      expect(decodedOnly?.pathResolved).toBe(false)
    } finally {
      fs.rmSync(homeRoot, { recursive: true, force: true })
      fs.rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  // `claude` run in `~` records the home directory as the project's cwd, so
  // `<cwd>/.claude/skills` is the user skills folder: every user skill was
  // listed again as a skill of that project. Also when the cwd reaches home
  // through a symlink.
  describe('a project whose root is the home directory', () => {
    let homeRoot = ''
    let cacheDir = ''

    beforeEach(() => {
      homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scanner-home-skills-'))
      cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scanner-home-skills-cache-'))
      fixtureHome.path = path.join(homeRoot, 'home')
      configureMetadataCacheDir(cacheDir)
      const skill = path.join(homeRoot, 'home', '.claude', 'skills', 'mine', 'SKILL.md')
      fs.mkdirSync(path.dirname(skill), { recursive: true })
      fs.writeFileSync(skill, '---\nname: mine\n---\nbody')
    })
    afterEach(() => {
      fs.rmSync(homeRoot, { recursive: true, force: true })
      fs.rmSync(cacheDir, { recursive: true, force: true })
    })

    function writeSession(dirName: string, cwd: string): void {
      const projectDir = path.join(homeRoot, 'home', '.claude', 'projects', dirName)
      fs.mkdirSync(projectDir, { recursive: true })
      const records = [
        {
          type: 'user',
          uuid: `u-${dirName}`,
          cwd,
          timestamp: '2026-09-10T09:59:00.000Z',
          message: { role: 'user', content: 'hi' },
        },
      ]
      fs.writeFileSync(
        path.join(projectDir, 'session.jsonl'),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      )
    }

    it('does not list the user skills again as that project’s skills', async () => {
      const home = path.join(homeRoot, 'home')
      writeSession('-home', home)

      const { projects } = await scanProjects(ANTHROPIC_PRICING)

      expect(projects.find((p) => p.id === '-home')?.localSkills).toEqual([])
    })

    it('does not list them when the cwd reaches home through a symlink', async (ctx) => {
      const linked = path.join(homeRoot, 'linked-home')
      try {
        fs.symlinkSync(path.join(homeRoot, 'home'), linked, 'dir')
      } catch {
        if (process.platform === 'win32') ctx.skip()
        throw new Error('could not create a symlink')
      }
      writeSession('-linked-home', linked)

      const { projects } = await scanProjects(ANTHROPIC_PRICING)

      expect(projects.find((p) => p.id === '-linked-home')?.localSkills).toEqual([])
    })

    it('still lists a real project’s own skills', async () => {
      const repo = path.join(homeRoot, 'repo')
      const skill = path.join(repo, '.claude', 'skills', 'local', 'SKILL.md')
      fs.mkdirSync(path.dirname(skill), { recursive: true })
      fs.writeFileSync(skill, '---\nname: local\n---\nbody')
      writeSession('-repo', repo)

      const { projects } = await scanProjects(ANTHROPIC_PRICING)

      expect(projects.find((p) => p.id === '-repo')?.localSkills.map((s) => s.id)).toEqual([
        'local',
      ])
    })
  })

  /**
   * Clean-install / empty-data guards (task-12-brief.md Step 1). A fresh
   * profile — or `CLAUDE_CONFIG_DIR` pointed at an empty scratch directory —
   * must render the dashboard's empty states rather than an error toast, so
   * `scanProjects` has to resolve `{ projects: [] }` without throwing for
   * each of these three shapes.
   */
  it('returns no projects, without throwing, when the Claude directory does not exist', async () => {
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-home-'))
    try {
      fixtureHome.path = homeRoot
      // No .claude directory created inside `homeRoot` — getClaudeDir()'s
      // `fs.promises.access` rejects, and the catch at
      // project-scanner.ts:48 returns `{ projects: [] }` instead of
      // propagating the rejection.
      await expect(scanProjects(ANTHROPIC_PRICING)).resolves.toEqual({ projects: [] })
    } finally {
      fs.rmSync(homeRoot, { recursive: true, force: true })
    }
  })

  it('returns no projects when projects/ exists but is empty', async () => {
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-projects-home-'))
    try {
      fixtureHome.path = homeRoot
      fs.mkdirSync(path.join(homeRoot, '.claude', 'projects'), { recursive: true })

      await expect(scanProjects(ANTHROPIC_PRICING)).resolves.toEqual({ projects: [] })
    } finally {
      fs.rmSync(homeRoot, { recursive: true, force: true })
    }
  })

  it('skips a project directory that contains no .jsonl files', async () => {
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-jsonl-home-'))
    try {
      fixtureHome.path = homeRoot
      const projectDir = path.join(homeRoot, '.claude', 'projects', '-fixture-no-jsonl')
      fs.mkdirSync(projectDir, { recursive: true })
      // A stray non-transcript file: the directory exists and is readable,
      // but `getValidSortedSessionForProject`'s `jsonlFiles.length === 0`
      // guard (project-scanner.ts:353) returns `[]` sessions for it, and
      // `scanProjects`' final `sessions.length > 0` filter (:77) then drops
      // the whole project rather than surfacing it with zero sessions.
      fs.writeFileSync(path.join(projectDir, 'notes.txt'), 'not a transcript')

      await expect(scanProjects(ANTHROPIC_PRICING)).resolves.toEqual({ projects: [] })
    } finally {
      fs.rmSync(homeRoot, { recursive: true, force: true })
    }
  })
})
