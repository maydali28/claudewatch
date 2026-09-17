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

// Every path helper config-service imports is pointed at a per-test temp tree
// (`<tmp>/home/.claude` stands in for the Claude directory). A mutable box is
// needed because vi.mock factories are hoisted above the test body.
const dirs = vi.hoisted(() => ({ tmp: '', claudeDir: '' }))
vi.mock('@main/lib/claude-paths', async () => {
  const p = await import('path')
  return {
    getClaudeDir: () => dirs.claudeDir,
    getClaudeJsonPath: () => p.join(dirs.tmp, 'home', '.claude.json'),
    getProjectsDirPath: () => p.join(dirs.claudeDir, 'projects'),
    getUserSettingsPath: () => p.join(dirs.claudeDir, 'settings.json'),
    getUserSettingsLocalPath: () => p.join(dirs.claudeDir, 'settings.local.json'),
    getMcpDebugLatestPath: () => p.join(dirs.claudeDir, 'debug', 'latest'),
  }
})

import {
  readSettingsLayers,
  mergeSettingsLayers,
  parseHooks,
  readExtendedConfig,
  readRawSettings,
  readMcps,
  readMemoryFiles,
} from './config-service'

// The fixture keeps `.claude` spelled `dot-claude` on disk: a common global
// gitignore entry (`**/.claude/settings.local.json`) would otherwise silently
// drop the local-layer fixture from the repo. Each test gets its own copy laid
// out the way Claude Code expects.
const FIXTURE_DIR = path.join(__dirname, '__fixtures__', 'demo-config')

let projectRoot: string

function copyFixture(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(path.join(FIXTURE_DIR, from), to)
}

function readJson(filePath: string): RawSettings {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RawSettings
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

const userSettingsPath = (): string => path.join(dirs.claudeDir, 'settings.json')
const projectSettingsPath = (): string => path.join(projectRoot, '.claude', 'settings.json')
const localSettingsPath = (): string => path.join(projectRoot, '.claude', 'settings.local.json')

beforeEach(() => {
  dirs.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'config-service-'))
  dirs.claudeDir = path.join(dirs.tmp, 'home', '.claude')
  projectRoot = path.join(dirs.tmp, 'workspace', 'demo-app')
  copyFixture('home/dot-claude/settings.json', userSettingsPath())
  copyFixture('project/dot-claude/settings.json', projectSettingsPath())
  copyFixture('project/dot-claude/settings.local.json', localSettingsPath())
})

afterEach(() => {
  fs.rmSync(dirs.tmp, { recursive: true, force: true })
})

const demoApp = () => ({ id: '-tmp-demo-app', name: 'demo-app', path: projectRoot })

describe('readSettingsLayers + parseHooks', () => {
  it('reads project hooks from <root>/.claude/settings.json, not ~/.claude/projects/<id>/settings.json', async () => {
    // The user fixture has no PreToolUse hook of its own; give it one so the
    // test proves a user rule and a project rule for the SAME event both
    // survive (the old shallow merge let the project replace the user's list).
    const user = readJson(userSettingsPath())
    user.hooks = {
      ...user.hooks,
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'user-guard.sh' }] }],
    }
    writeJson(userSettingsPath(), user)

    const layers = await readSettingsLayers(demoApp())
    expect(layers.map((l) => l.scope)).toEqual(['user', 'project', 'local'])

    const groups = parseHooks(layers)
    const pre = groups.find((g) => g.event === 'PreToolUse')!
    expect(pre.rules.map((r) => r.scope)).toEqual(['user', 'project']) // both kept — no replacement
    expect(pre.rules[0].sourcePath).toBe(userSettingsPath())
    expect(pre.rules[0].hooks[0].command).toBe('user-guard.sh')
    expect(pre.rules[1].sourcePath).toBe(projectSettingsPath())
    expect(pre.rules[1].matcher).toBe('Edit|Write')
    expect(pre.rules[1].hooks[0].statusMessage).toBeUndefined()
    expect(pre.rules[1].projectName).toBe('demo-app')
    expect(new Set(pre.rules.map((r) => r.id)).size).toBe(2)

    const ups = groups.find((g) => g.event === 'UserPromptSubmit')!
    expect(ups.rules.find((r) => r.scope === 'project')!.hooks[0].statusMessage).toBe(
      'Collecting snapshot…'
    )

    // User-only events from the fixture are still there, attributed to the user file.
    const preCompact = groups.find((g) => g.event === 'PreCompact')!
    expect(preCompact.rules).toHaveLength(1)
    expect(preCompact.rules[0].scope).toBe('user')
    expect(preCompact.rules[0].sourcePath).toBe(userSettingsPath())
    expect(preCompact.rules[0].projectId).toBeUndefined()
  })

  it('returns user and user-local layers first, and only the user layers without a project', async () => {
    writeJson(path.join(dirs.claudeDir, 'settings.local.json'), { env: { A: '1' } })

    expect((await readSettingsLayers(demoApp())).map((l) => l.scope)).toEqual([
      'user',
      'user-local',
      'project',
      'local',
    ])
    expect((await readSettingsLayers()).map((l) => l.scope)).toEqual(['user', 'user-local'])
  })

  it('gives rules from different layers ids that cannot collide', () => {
    const rule = { hooks: [{ command: 'x' }] }
    const groups = parseHooks([
      { scope: 'user', path: 'u', settings: { hooks: { Stop: [rule] } } },
      { scope: 'project', path: 'p', settings: { hooks: { Stop: [rule] } } },
    ])
    expect(groups[0].rules.map((r) => r.id)).toEqual(['user:Stop-0', 'project:Stop-1'])
  })
})

describe('mergeSettingsLayers', () => {
  it('merges lists and takes scalars from the highest layer', () => {
    const merged = mergeSettingsLayers([
      {
        scope: 'user',
        path: 'u',
        settings: {
          permissions: { allow: ['Bash(a)'] },
          env: { X: '1', Y: 'u' },
          plansDirectory: 'plans-user',
        },
      },
      {
        scope: 'project',
        path: 'p',
        settings: { permissions: { allow: ['Bash(b)'] }, env: { Y: 'p' } },
      },
      { scope: 'local', path: 'l', settings: { plansDirectory: './plans' } },
    ])
    expect(merged.permissions?.allow).toEqual(['Bash(a)', 'Bash(b)'])
    expect(merged.env).toEqual({ X: '1', Y: 'p' })
    expect(merged.plansDirectory).toBe('./plans')
  })

  it('concatenates hooks per event and merges mcpServers key-wise', () => {
    const merged = mergeSettingsLayers([
      {
        scope: 'user',
        path: 'u',
        settings: {
          hooks: { Stop: [{ command: 'u' }] },
          mcpServers: { a: { command: 'user-a' }, b: { command: 'user-b' } },
        },
      },
      {
        scope: 'local',
        path: 'l',
        settings: {
          hooks: { Stop: [{ command: 'l' }] },
          mcpServers: { b: { command: 'local-b' } },
        },
      },
    ])
    expect(merged.hooks?.Stop).toEqual([{ command: 'u' }, { command: 'l' }])
    expect(merged.mcpServers).toEqual({ a: { command: 'user-a' }, b: { command: 'local-b' } })
  })

  it('reads the fixture local layer permissions through readRawSettings', async () => {
    const raw = await readRawSettings(demoApp())
    expect(raw.permissions?.allow).toContain('Bash(git status)')
    expect(raw.permissions?.deny).toEqual(['Read(./.env)'])
    expect(raw.hooks?.PreCompact).toHaveLength(1)
    expect(raw.hooks?.Stop).toHaveLength(1)
  })
})

describe('readExtendedConfig', () => {
  it('readExtendedConfig lists hooks for every resolved project with its name attached', async () => {
    const cfg = await readExtendedConfig([{ id: 'p1', name: 'demo-app', path: projectRoot }])
    const projectRules = cfg.hooks.flatMap((g) => g.rules).filter((r) => r.scope === 'project')
    expect(projectRules.length).toBeGreaterThan(0)
    expect(projectRules.every((r) => r.projectName === 'demo-app')).toBe(true)
    expect(projectRules.every((r) => r.projectId === 'p1')).toBe(true)
    // And the user hooks are still there alongside them.
    expect(cfg.hooks.flatMap((g) => g.rules).some((r) => r.scope === 'user')).toBe(true)
  })

  it('takes panel scalars from the user layers only', async () => {
    writeJson(projectSettingsPath(), {
      ...readJson(projectSettingsPath()),
      skipDangerousModePermissionPrompt: true,
    })
    const cfg = await readExtendedConfig([demoApp()])
    expect(cfg.skipDangerousModePermissionPrompt).toBe(false)
  })

  it('ignores the legacy ~/.claude/projects/<id>/settings.json location entirely', async () => {
    const id = '-tmp-demo-app'
    const legacyPath = path.join(dirs.claudeDir, 'projects', id, 'settings.json')
    writeJson(legacyPath, {
      hooks: { Notification: [{ hooks: [{ type: 'command', command: 'legacy.sh' }] }] },
      mcpServers: { legacy: { command: 'legacy-mcp' } },
    })

    const project = demoApp()
    const layers = await readSettingsLayers(project)
    expect(layers.map((l) => l.path)).not.toContain(legacyPath)

    const cfg = await readExtendedConfig([project])
    expect(cfg.hooks.find((g) => g.event === 'Notification')).toBeUndefined()
    const allCommands = cfg.hooks.flatMap((g) =>
      g.rules.flatMap((r) => r.hooks.map((h) => h.command))
    )
    expect(allCommands).not.toContain('legacy.sh')

    expect((await readRawSettings(project)).hooks?.Notification).toBeUndefined()
    expect((await readMcps(project)).map((m) => m.name)).not.toContain('legacy')
  })
})

describe('readMcps', () => {
  it('labels each server with the level of the layer that defined it; ~/.claude.json stays global', async () => {
    writeJson(path.join(dirs.tmp, 'home', '.claude.json'), {
      mcpServers: { fromClaudeJson: { command: 'a' }, shared: { command: 'global-shared' } },
    })
    writeJson(userSettingsPath(), {
      ...readJson(userSettingsPath()),
      mcpServers: { fromUser: { command: 'b' } },
    })
    writeJson(projectSettingsPath(), {
      ...readJson(projectSettingsPath()),
      mcpServers: { fromProject: { url: 'https://p' }, shared: { command: 'project-shared' } },
    })
    writeJson(localSettingsPath(), {
      ...readJson(localSettingsPath()),
      mcpServers: { fromLocal: { command: 'd' } },
    })

    const mcps = await readMcps(demoApp())
    const byName = Object.fromEntries(mcps.map((m) => [m.name, m]))
    expect(mcps.map((m) => m.name)).toEqual([
      'fromClaudeJson',
      'shared',
      'fromUser',
      'fromProject',
      'fromLocal',
    ])
    expect(byName.fromClaudeJson.level).toBe('global')
    expect(byName.shared.level).toBe('global')
    expect(byName.shared.command).toBe('global-shared') // first definition wins
    expect(byName.fromUser.level).toBe('global')
    expect(byName.fromProject.level).toBe('project')
    expect(byName.fromProject.type).toBe('sse')
    expect(byName.fromLocal.level).toBe('local')
    expect(byName.fromLocal.status).toBe('unknown')

    const withoutProject = await readMcps()
    expect(withoutProject.map((m) => m.name)).toEqual(['fromClaudeJson', 'shared', 'fromUser'])
  })
})

describe('readMemoryFiles', () => {
  it('reads the project CLAUDE.md from the project root and memory/ from the Claude projects dir', async () => {
    const id = '-tmp-demo-app'
    fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), 'root instructions')
    const legacyClaudeMd = path.join(dirs.claudeDir, 'projects', id, 'CLAUDE.md')
    fs.mkdirSync(path.dirname(legacyClaudeMd), { recursive: true })
    fs.writeFileSync(legacyClaudeMd, 'legacy instructions')
    const memoryFile = path.join(dirs.claudeDir, 'projects', id, 'memory', 'note.md')
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true })
    fs.writeFileSync(memoryFile, 'remember this')

    const files = await readMemoryFiles(id, demoApp())
    const projectMd = files.find((f) => f.id === 'project-claude-md')!
    expect(projectMd.path).toBe(path.join(projectRoot, 'CLAUDE.md'))
    expect(projectMd.content).toBe('root instructions')
    expect(files.map((f) => f.path)).not.toContain(legacyClaudeMd)
    expect(files.find((f) => f.id === 'memory-note.md')?.path).toBe(memoryFile)

    // Without a resolved root there is no project CLAUDE.md to show, never the legacy one.
    const unresolved = await readMemoryFiles(id)
    expect(unresolved.find((f) => f.id === 'project-claude-md')).toBeUndefined()
    expect(unresolved.find((f) => f.id === 'memory-note.md')).toBeDefined()
  })
})
