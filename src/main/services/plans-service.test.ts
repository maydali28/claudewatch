import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { RawSettings } from '@shared/types/config'

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

// Every path helper plans-service (and, transitively, config-service) imports
// is pointed at a per-test temp tree, mirroring config-service.test.ts.
const dirs = vi.hoisted(() => ({ tmp: '', claudeDir: '' }))
vi.mock('@main/lib/claude-paths', async () => {
  const p = await import('path')
  return {
    getClaudeDir: () => dirs.claudeDir,
    getClaudeJsonPath: () => p.join(dirs.tmp, 'home', '.claude.json'),
    getProjectsDirPath: () => p.join(dirs.claudeDir, 'projects'),
    getUserSettingsPath: () => p.join(dirs.claudeDir, 'settings.json'),
    getMcpDebugLatestPath: () => p.join(dirs.claudeDir, 'debug', 'latest'),
    getUserCommandsDirPath: () => p.join(dirs.claudeDir, 'commands'),
    getDefaultPlansDirPath: () => p.join(dirs.claudeDir, 'plans'),
  }
})

import {
  planDirectoryFor,
  resolvePlanDirectories,
  listPlans,
  readPlan,
  projectNamesForSlug,
  type PlanDirectory,
} from './plans-service'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-service-'))
  dirs.tmp = tmp
  dirs.claudeDir = path.join(tmp, 'home', '.claude')
  fs.mkdirSync(dirs.claudeDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('planDirectoryFor', () => {
  it.each<[RawSettings, string, string, string]>([
    [{}, '/r', '/d', '/d'],
    [{ plansDirectory: './plans' }, '/r', '/d', '/r/plans'],
    [{ plansDirectory: 'docs/plans' }, '/r', '/d', '/r/docs/plans'],
    [{ plansDirectory: '../outside' }, '/r', '/d', '/d'],
    [{ plansDirectory: '/abs/elsewhere' }, '/r', '/d', '/d'],
  ])('%o in %s → %s', (settings, root, def, expected) => {
    expect(planDirectoryFor(settings, root, def)).toBe(expected)
  })

  it('treats an empty or whitespace-only plansDirectory as unset', () => {
    expect(planDirectoryFor({ plansDirectory: '   ' }, '/r', '/d')).toBe('/d')
  })

  it('keeps a plansDirectory that resolves to the project root itself', () => {
    expect(planDirectoryFor({ plansDirectory: '.' }, '/r', '/d')).toBe('/r')
  })

  it('treats a non-string plansDirectory (wrong type in a hand-edited settings file) as unset', () => {
    expect(planDirectoryFor({ plansDirectory: 5 } as unknown as RawSettings, '/r', '/d')).toBe('/d')
    expect(planDirectoryFor({ plansDirectory: [] } as unknown as RawSettings, '/r', '/d')).toBe(
      '/d'
    )
  })
})

describe('resolvePlanDirectories + listPlans', () => {
  it('keeps resolving every project when one has a malformed settings file', async () => {
    // A single `"permissions": {"allow": {}}` anywhere used to throw out of
    // mergeSettingsLayers, reject this call, and blank the Plans view for
    // every project — not just the one with the bad file.
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })

    const brokenRoot = path.join(tmp, 'workspace', 'broken')
    fs.mkdirSync(path.join(brokenRoot, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(brokenRoot, '.claude', 'settings.json'),
      '{"permissions": {"allow": {}}}'
    )

    const goodRoot = path.join(tmp, 'workspace', 'good')
    fs.mkdirSync(path.join(goodRoot, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(goodRoot, '.claude', 'settings.json'),
      JSON.stringify({ plansDirectory: './plans' })
    )

    const broken = { id: 'broken', name: 'broken', path: brokenRoot }
    const good = { id: 'good', name: 'good', path: goodRoot }

    await expect(resolvePlanDirectories([broken, good])).resolves.toEqual([
      { directory: defaultDir, scope: 'default' },
      { directory: path.join(goodRoot, 'plans'), scope: 'project', project: good },
    ])
  })

  it('lists plans from the default dir and from a project plansDirectory, labelled', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })
    fs.writeFileSync(path.join(defaultDir, 'default-plan.md'), '# Default Plan\n')

    const projectRoot = path.join(tmp, 'workspace', 'demo-app')
    const dotClaude = path.join(projectRoot, '.claude')
    fs.mkdirSync(dotClaude, { recursive: true })
    fs.writeFileSync(
      path.join(dotClaude, 'settings.local.json'),
      JSON.stringify({ plansDirectory: './plans' })
    )
    const projectPlansDir = path.join(projectRoot, 'plans')
    fs.mkdirSync(projectPlansDir, { recursive: true })
    fs.writeFileSync(path.join(projectPlansDir, 'x.md'), '# Project Plan\n')
    // A non-.md file must be skipped.
    fs.writeFileSync(path.join(projectPlansDir, 'notes.txt'), 'ignore me')

    const project = { id: 'demo-app', name: 'demo-app', path: projectRoot }
    const resolvedDirs = await resolvePlanDirectories([project])

    expect(resolvedDirs).toEqual([
      { directory: defaultDir, scope: 'default' },
      { directory: projectPlansDir, scope: 'project', project },
    ])

    const plans = await listPlans(resolvedDirs)
    expect(plans.map((p) => p.filename).sort()).toEqual(['default-plan.md', 'x.md'])

    const projectPlan = plans.find((p) => p.filename === 'x.md')
    expect(projectPlan).toMatchObject({
      scope: 'project',
      projectId: 'demo-app',
      projectName: 'demo-app',
      directory: projectPlansDir,
      id: path.join(projectPlansDir, 'x.md'),
    })

    const defaultPlan = plans.find((p) => p.filename === 'default-plan.md')
    expect(defaultPlan).toMatchObject({ scope: 'default', directory: defaultDir })
    expect(defaultPlan?.projectId).toBeUndefined()
  })

  it('does not duplicate the default dir when a project has no plansDirectory setting', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })

    const projectRoot = path.join(tmp, 'workspace', 'demo-app')
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true })
    // A project without an explicit plansDirectory falls back to the default.
    const project = { id: 'demo-app', name: 'demo-app', path: projectRoot }

    const resolvedDirs = await resolvePlanDirectories([project])
    expect(resolvedDirs).toEqual([{ directory: defaultDir, scope: 'default' }])
  })

  it('does not duplicate the default dir when an explicit plansDirectory resolves back to it', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans') // tmp/home/.claude/plans
    fs.mkdirSync(defaultDir, { recursive: true })

    // The default dir lives under `dirs.claudeDir`, which is never inside an
    // arbitrary project root — an explicit `plansDirectory` can only
    // legitimately resolve back to it when the project root is an ancestor
    // of the Claude dir. Built here with a project root at `tmp` itself (an
    // ancestor of `tmp/home/.claude`), with its OWN `.claude` at `tmp/.claude`
    // — distinct from the real Claude dir at `tmp/home/.claude` — holding the
    // setting, so the two configs don't collide.
    const projectRoot = tmp
    const relativeToDefault = path.relative(projectRoot, defaultDir)
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(projectRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ plansDirectory: relativeToDefault })
    )

    const project = { id: 'root-project', name: 'root-project', path: projectRoot }
    const resolvedDirs = await resolvePlanDirectories([project])
    expect(resolvedDirs).toEqual([{ directory: defaultDir, scope: 'default' }])
  })

  it('tolerates a plans directory that does not exist yet', async () => {
    const missing: PlanDirectory = {
      directory: path.join(dirs.claudeDir, 'plans'), // never created
      scope: 'default',
    }
    await expect(listPlans([missing])).resolves.toEqual([])
  })

  it('lists only regular .md files, skipping a symlink even when it points at a real .md file', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })
    fs.writeFileSync(path.join(defaultDir, 'real.md'), '# Real\n')

    const outsideTarget = path.join(tmp, 'outside.md')
    fs.writeFileSync(outsideTarget, '# Outside\n')
    fs.symlinkSync(outsideTarget, path.join(defaultDir, 'linked.md'))

    const resolvedDirs: PlanDirectory[] = [{ directory: defaultDir, scope: 'default' }]
    const plans = await listPlans(resolvedDirs)
    expect(plans.map((p) => p.filename)).toEqual(['real.md'])
  })
})

describe('readPlan', () => {
  it('reads a plan from its resolved directory', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })
    const filePath = path.join(defaultDir, 'a.md')
    fs.writeFileSync(filePath, '# A Plan\ncontent here')
    const resolvedDirs: PlanDirectory[] = [{ directory: defaultDir, scope: 'default' }]

    const detail = await readPlan(filePath, resolvedDirs)
    expect(detail.title).toBe('A Plan')
    expect(detail.filename).toBe('a.md')
    expect(detail.directory).toBe(defaultDir)
    expect(detail.content).toContain('content here')
  })

  it('refuses an id outside the resolved directories', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })
    const resolvedDirs: PlanDirectory[] = [{ directory: defaultDir, scope: 'default' }]

    await expect(readPlan('/etc/passwd', resolvedDirs)).rejects.toThrow('Plan not found')
  })

  it('refuses a non-.md file inside the plan dir, e.g. a project root .env via plansDirectory "."', async () => {
    // `plansDirectory: "."` is deliberately allowed (it resolves to the
    // project root itself, per `planDirectoryFor`'s own test), so the dir
    // here can legitimately contain non-plan files like `.env`.
    const projectRoot = path.join(tmp, 'workspace', 'demo-app')
    fs.mkdirSync(projectRoot, { recursive: true })
    fs.writeFileSync(path.join(projectRoot, '.env'), 'SECRET=1')
    const project = { id: 'demo-app', name: 'demo-app', path: projectRoot }
    const resolvedDirs: PlanDirectory[] = [{ directory: projectRoot, scope: 'project', project }]

    await expect(readPlan(path.join(projectRoot, '.env'), resolvedDirs)).rejects.toThrow(
      'Plan not found'
    )
  })

  it('refuses an id whose basename is ".." (escapes the plan dir despite matching path.join)', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })
    const resolvedDirs: PlanDirectory[] = [{ directory: defaultDir, scope: 'default' }]

    await expect(readPlan(path.join(defaultDir, '..'), resolvedDirs)).rejects.toThrow(
      'Plan not found'
    )
  })

  it('refuses the plan directory itself as an id', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })
    const resolvedDirs: PlanDirectory[] = [{ directory: defaultDir, scope: 'default' }]

    await expect(readPlan(defaultDir, resolvedDirs)).rejects.toThrow('Plan not found')
  })

  it('refuses a .md symlink inside the dir that points outside it', async () => {
    const defaultDir = path.join(dirs.claudeDir, 'plans')
    fs.mkdirSync(defaultDir, { recursive: true })
    const outsideTarget = path.join(tmp, 'outside.md')
    fs.writeFileSync(outsideTarget, '# Outside\nsecret content')
    const linkPath = path.join(defaultDir, 'linked.md')
    fs.symlinkSync(outsideTarget, linkPath)
    const resolvedDirs: PlanDirectory[] = [{ directory: defaultDir, scope: 'default' }]

    await expect(readPlan(linkPath, resolvedDirs)).rejects.toThrow('Plan not found')
  })
})

describe('projectNamesForSlug', () => {
  it('matches directories whose transcripts mention the slug to a project name, once for merged worktrees', async () => {
    const projectsDir = path.join(dirs.claudeDir, 'projects')
    const dirA = path.join(projectsDir, 'proj-a')
    const dirAWorktree = path.join(projectsDir, 'proj-a--claude-worktrees-feat')
    fs.mkdirSync(dirA, { recursive: true })
    fs.mkdirSync(dirAWorktree, { recursive: true })
    fs.writeFileSync(path.join(dirA, 's1.jsonl'), 'no match here\n')
    // The slug match lands on the worktree directory, not on `project.id`
    // itself, so this only passes if the lookup checks every session's
    // `projectId` (the merge group) rather than just `project.id`.
    fs.writeFileSync(path.join(dirAWorktree, 's2.jsonl'), '{"slug":"my-slug"}\n')

    const dirB = path.join(projectsDir, 'proj-b')
    fs.mkdirSync(dirB, { recursive: true })
    fs.writeFileSync(path.join(dirB, 's3.jsonl'), 'no match here either\n')

    const projects = [
      {
        id: 'proj-a',
        name: 'Demo App',
        sessions: [{ projectId: 'proj-a' }, { projectId: 'proj-a--claude-worktrees-feat' }],
      },
      { id: 'proj-b', name: 'Other App', sessions: [{ projectId: 'proj-b' }] },
    ]

    const names = await projectNamesForSlug('my-slug', projects)
    expect(names).toEqual(['Demo App'])
  })

  it('returns an empty list when the projects directory is missing, even with real projects to match against', async () => {
    // `dirs.claudeDir/projects` is never created in this test — a bare `[]`
    // project list would pass trivially regardless of the missing-directory
    // handling, since there would be no names to return either way. A
    // non-empty list makes the assertion mean what it says: matching the
    // slug fails because the directory can't be scanned, not because there
    // was nothing to match.
    const names = await projectNamesForSlug('my-slug', [
      { id: 'proj-a', name: 'Demo App', sessions: [{ projectId: 'proj-a' }] },
    ])
    expect(names).toEqual([])
  })
})
