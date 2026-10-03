import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { RawSettings, SettingsLayer } from '@shared/types/config'

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
    getMcpDebugLatestPath: () => p.join(dirs.claudeDir, 'debug', 'latest'),
    getUserCommandsDirPath: () => p.join(dirs.claudeDir, 'commands'),
    getPluginsDirPath: () => p.join(dirs.claudeDir, 'plugins'),
    getUserSkillsDirPath: () => p.join(dirs.claudeDir, 'skills'),
    getManagedSettingsPath: () => p.join(dirs.tmp, 'managed', 'managed-settings.json'),
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
  readCommands,
  readAllSkills,
  readPlugins,
  readAllAutoMemory,
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

  it('returns the user layer first, and only the user layer without a project', async () => {
    // `<claudeDir>/settings.local.json` is NOT a user scope. Claude Code's
    // scopes are managed, project-local, shared project and user; that file is
    // just the project-local file of a project whose root is the home
    // directory — see the home-directory suite below, which reads it exactly
    // once, as that project's `local` layer.
    writeJson(path.join(dirs.claudeDir, 'settings.local.json'), { env: { A: '1' } })

    expect((await readSettingsLayers(demoApp())).map((l) => l.scope)).toEqual([
      'user',
      'project',
      'local',
    ])
    expect((await readSettingsLayers()).map((l) => l.scope)).toEqual(['user'])
  })

  it('gives rules from different layers ids that cannot collide', () => {
    const rule = { hooks: [{ command: 'x' }] }
    const groups = parseHooks([
      { scope: 'user', path: 'u', settings: { hooks: { Stop: [rule] } } },
      { scope: 'project', path: 'p', settings: { hooks: { Stop: [rule] } } },
    ])
    expect(groups[0].rules.map((r) => r.id)).toEqual(['user:Stop-0', 'project:Stop-0'])
  })

  it('gives two projects contributing rules for the same event distinct ids', () => {
    const rule = { hooks: [{ command: 'x' }] }
    const projectA: SettingsLayer = {
      scope: 'project',
      path: 'a/.claude/settings.json',
      settings: { hooks: { Stop: [rule] } },
      project: { id: 'proj-a', name: 'proj-a', path: '/a' },
    }
    const projectB: SettingsLayer = {
      scope: 'project',
      path: 'b/.claude/settings.json',
      settings: { hooks: { Stop: [rule] } },
      project: { id: 'proj-b', name: 'proj-b', path: '/b' },
    }

    const groups = parseHooks([projectA, projectB])
    const ids = groups[0].rules.map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids).toEqual(['project:proj-a:Stop-0', 'project:proj-b:Stop-0'])
  })

  it('keeps a project rule id stable when a user rule is added for the same event', () => {
    const rule = { hooks: [{ command: 'x' }] }
    const projectLayer: SettingsLayer = {
      scope: 'project',
      path: 'a/.claude/settings.json',
      settings: { hooks: { Stop: [rule] } },
      project: { id: 'proj-a', name: 'proj-a', path: '/a' },
    }
    const userLayer: SettingsLayer = {
      scope: 'user',
      path: 'u',
      settings: { hooks: { Stop: [rule] } },
    }

    const idBefore = parseHooks([projectLayer])[0].rules[0].id
    const idAfter = parseHooks([userLayer, projectLayer])[0].rules.find(
      (r) => r.scope === 'project'
    )!.id

    expect(idAfter).toBe(idBefore)
  })

  it('never produces an id containing "::", the selectedHookId group/rule separator', async () => {
    const cfg = await readExtendedConfig([demoApp()])
    const allIds = cfg.hooks.flatMap((g) => g.rules.map((r) => r.id))
    expect(allIds.length).toBeGreaterThan(0)
    for (const id of allIds) {
      expect(id).not.toContain('::')
    }
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

  it('ignores a permissions list that a hand-edited file made an object', () => {
    // One project with `"permissions": {"allow": {}}` used to throw out of the
    // spread here, and that single exception blanked the Plans view for every
    // project and broke the lint run.
    const broken = JSON.parse('{"permissions": {"allow": {}, "deny": "nope"}}') as RawSettings
    const merged = mergeSettingsLayers([
      {
        scope: 'user',
        path: 'u',
        settings: { permissions: { allow: ['Bash(a)'], deny: ['Read(./.env)'] } },
      },
      { scope: 'project', path: 'p', settings: broken },
    ])
    expect(merged.permissions?.allow).toEqual(['Bash(a)'])
    expect(merged.permissions?.deny).toEqual(['Read(./.env)'])
  })

  it('ignores env, mcpServers, permissions and hooks that are not objects', () => {
    const broken = JSON.parse(
      '{"env": "nope", "mcpServers": [], "permissions": "all", "hooks": 3}'
    ) as RawSettings
    const merged = mergeSettingsLayers([
      { scope: 'user', path: 'u', settings: { env: { X: '1' } } },
      { scope: 'project', path: 'p', settings: broken },
    ])
    expect(merged.env).toEqual({ X: '1' })
    expect(merged.mcpServers).toBeUndefined()
    expect(merged.permissions).toBeUndefined()
    expect(merged.hooks).toBeUndefined()
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

  it('gives every settings rule its source', async () => {
    const cfg = await readExtendedConfig([demoApp()])
    const rules = cfg.hooks.flatMap((g) => g.rules)
    expect(rules.find((r) => r.scope === 'user')?.source).toEqual({
      kind: 'user',
      id: 'user',
      label: 'Global',
    })
    expect(rules.find((r) => r.scope === 'project')?.source).toMatchObject({
      kind: 'project',
      id: 'project:-tmp-demo-app',
      projectName: 'demo-app',
      root: projectRoot,
    })
  })
})

describe('readExtendedConfig — plugin and managed hooks', () => {
  const pluginsDir = (): string => path.join(dirs.claudeDir, 'plugins')
  const managedPath = (): string => path.join(dirs.tmp, 'managed', 'managed-settings.json')

  function installPluginWithHook(name: string, command: string): string {
    const root = path.join(pluginsDir(), 'cache', 'official', name, '1.0.0')
    writeJson(path.join(root, '.claude-plugin', 'plugin.json'), { name })
    writeJson(path.join(root, 'hooks', 'hooks.json'), {
      hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command }] }] },
    })
    return root
  }

  beforeEach(() => {
    const enabled = installPluginWithHook('superpowers', '${CLAUDE_PLUGIN_ROOT}/hooks/run.sh')
    const disabled = installPluginWithHook('sleepy', 'sleepy.sh')
    writeJson(path.join(pluginsDir(), 'installed_plugins.json'), {
      version: 2,
      plugins: {
        'superpowers@official': [{ installPath: enabled, version: '1.0.0' }],
        'sleepy@official': [{ installPath: disabled, version: '1.0.0' }],
      },
    })
    writeJson(userSettingsPath(), {
      ...readJson(userSettingsPath()),
      enabledPlugins: { 'superpowers@official': true },
    })
  })

  const sessionStartRules = async () =>
    (await readExtendedConfig([demoApp()])).hooks.find((g) => g.event === 'SessionStart')?.rules ??
    []

  it('lists each plugin’s hooks with the plugin as source and the hooks file as path', async () => {
    const rule = (await sessionStartRules()).find((r) => r.source.label === 'superpowers')!
    expect(rule).toMatchObject({
      id: 'plugin:superpowers@official:SessionStart-0',
      scope: 'plugin',
      matcher: 'startup',
      source: { kind: 'plugin', plugin: { enabled: true, origin: 'marketplace' } },
    })
    expect(rule.sourcePath.endsWith(path.join('hooks', 'hooks.json'))).toBe(true)
    expect(rule.inactiveReason).toBeUndefined()
  })

  it('marks the hooks of a disabled plugin as not running', async () => {
    const rule = (await sessionStartRules()).find((r) => r.source.label === 'sleepy')!
    expect(rule.inactiveReason).toBe('plugin-disabled')
  })

  it('lists managed hooks, and marks every other hook inactive when managed settings allow only theirs', async () => {
    writeJson(managedPath(), {
      allowManagedHooksOnly: true,
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'audit.sh' }] }] },
    })

    const cfg = await readExtendedConfig([demoApp()])
    const rules = cfg.hooks.flatMap((g) => g.rules)
    const managed = rules.filter((r) => r.scope === 'managed')

    expect(managed).toHaveLength(1)
    expect(managed[0]).toMatchObject({
      id: 'managed:SessionStart-0',
      sourcePath: managedPath(),
      source: { kind: 'managed', id: 'managed', label: 'Managed' },
    })
    expect(managed[0].inactiveReason).toBeUndefined()
    const others = rules.filter((r) => r.scope !== 'managed')
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((r) => r.inactiveReason !== undefined)).toBe(true)
    // A disabled plugin's own reason wins: it would not run even without the managed rule.
    expect(others.find((r) => r.source.label === 'sleepy')?.inactiveReason).toBe('plugin-disabled')
    expect(others.find((r) => r.scope === 'user')?.inactiveReason).toBe('managed-only')
  })

  it('lets managed enabledPlugins switch a plugin off', async () => {
    writeJson(managedPath(), { enabledPlugins: { 'superpowers@official': false } })
    const rule = (await sessionStartRules()).find((r) => r.source.label === 'superpowers')!
    expect(rule.inactiveReason).toBe('plugin-disabled')
  })
})

describe('readAllSkills', () => {
  const pluginsDir = (): string => path.join(dirs.claudeDir, 'plugins')

  function writeSkill(dir: string, name: string, description: string): void {
    fs.mkdirSync(path.join(dir, name), { recursive: true })
    fs.writeFileSync(
      path.join(dir, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}.`
    )
  }

  beforeEach(() => {
    writeSkill(path.join(dirs.claudeDir, 'skills'), 'humanizer', 'Remove AI tells')

    const root = path.join(pluginsDir(), 'cache', 'official', 'superpowers', '6.4.1')
    writeJson(path.join(root, '.claude-plugin', 'plugin.json'), { name: 'superpowers' })
    writeSkill(path.join(root, 'skills'), 'brainstorming', 'Explore intent first')
    writeJson(path.join(pluginsDir(), 'installed_plugins.json'), {
      version: 2,
      plugins: { 'superpowers@official': [{ installPath: root, version: '6.4.1' }] },
    })
    writeJson(userSettingsPath(), {
      ...readJson(userSettingsPath()),
      enabledPlugins: { 'superpowers@official': true },
    })
    copyFixture(
      'project/dot-claude/commands/ship.md',
      path.join(projectRoot, '.claude', 'commands', 'ship.md')
    )
  })

  const projectWith = (sessions: Array<{ lastTimestamp: string; skillListing?: unknown }>) => ({
    id: '-tmp-demo-app',
    name: 'demo-app',
    path: projectRoot,
    pathResolved: true,
    localSkills: [
      {
        id: 'repo-skill',
        name: 'repo-skill',
        displayName: 'repo-skill',
        metadata: {},
        body: 'Project skill.',
        sizeBytes: 14,
      },
    ],
    sessions: sessions as Array<{
      lastTimestamp: string
      skillListing?: Array<{ name: string; description?: string }>
    }>,
  })

  it('lists user, project and plugin skills from disk with their sources', async () => {
    const skills = await readAllSkills([projectWith([])])
    const byName = new Map(skills.map((s) => [s.name, s]))

    expect(byName.get('humanizer')).toMatchObject({
      source: { kind: 'user' },
      description: 'Remove AI tells',
      filePath: path.join(dirs.claudeDir, 'skills', 'humanizer', 'SKILL.md'),
    })
    expect(byName.get('repo-skill')?.source).toMatchObject({ kind: 'project', label: 'demo-app' })
    expect(byName.get('superpowers:brainstorming')).toMatchObject({
      source: { kind: 'plugin', id: 'plugin:superpowers@official' },
      body: 'Body of brainstorming.',
    })
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length)
  })

  it('adds the skills sessions listed that have no file, classified by name', async () => {
    const skills = await readAllSkills([
      projectWith([
        {
          lastTimestamp: '2026-09-01T10:00:00.000Z',
          skillListing: [
            { name: 'humanizer', description: 'dup' },
            { name: 'superpowers:brainstorming' },
            { name: 'code-review', description: 'Review the diff' },
            { name: 'anthropic-skills:docx', description: 'Word files' },
            { name: 'gone-plugin:thing' },
            { name: 'ship' },
          ],
        },
        {
          lastTimestamp: '2026-09-20T10:00:00.000Z',
          skillListing: [{ name: 'code-review' }],
        },
      ]),
    ])
    const byName = new Map(skills.map((s) => [s.name, s]))

    // On disk already: not listed twice, but usage is attached.
    expect(skills.filter((s) => s.name === 'humanizer')).toHaveLength(1)
    expect(byName.get('humanizer')).toMatchObject({
      sessionCount: 1,
      lastSeen: '2026-09-01T10:00:00.000Z',
    })
    expect(skills.filter((s) => s.name === 'superpowers:brainstorming')).toHaveLength(1)

    expect(byName.get('code-review')).toMatchObject({
      source: { kind: 'builtin', id: 'builtin', label: 'Built-in' },
      description: 'Review the diff',
      sessionOnly: true,
      sessionCount: 2,
      lastSeen: '2026-09-20T10:00:00.000Z',
      body: '',
    })
    expect(byName.get('anthropic-skills:docx')?.source).toMatchObject({
      kind: 'plugin',
      label: 'anthropic-skills',
      plugin: { origin: 'claude.ai', enabled: true },
    })
    expect(byName.get('gone-plugin:thing')?.source).toMatchObject({
      kind: 'plugin',
      label: 'gone-plugin',
      plugin: { installed: false },
    })
    expect(byName.get('ship')).toMatchObject({
      exposedAs: 'command',
      source: { kind: 'project', label: 'demo-app' },
      sessionOnly: true,
    })
  })
})

describe('readPlugins', () => {
  const pluginsDir = (): string => path.join(dirs.claudeDir, 'plugins')

  it('lists every installed plugin with what its plugin.json says about it', async () => {
    const root = path.join(pluginsDir(), 'cache', 'official', 'superpowers', '6.4.1')
    writeJson(path.join(root, '.claude-plugin', 'plugin.json'), {
      name: 'superpowers',
      description: 'Core skills library',
      author: { name: 'Jesse', email: 'x@example.com' },
      homepage: 'https://example.com/superpowers',
    })
    const bare = path.join(pluginsDir(), 'cache', 'official', 'bare', '1')
    writeJson(path.join(bare, '.claude-plugin', 'plugin.json'), { name: 'bare', author: 'Solo' })
    writeJson(path.join(pluginsDir(), 'installed_plugins.json'), {
      version: 2,
      plugins: {
        'superpowers@official': [{ installPath: root, version: '6.4.1' }],
        'bare@official': [{ installPath: bare }],
      },
    })

    const plugins = await readPlugins()

    expect(plugins.map((p) => p.source.label)).toEqual(['bare', 'superpowers'])
    expect(plugins[1]).toMatchObject({
      source: { kind: 'plugin', id: 'plugin:superpowers@official' },
      description: 'Core skills library',
      author: 'Jesse',
      homepage: 'https://example.com/superpowers',
    })
    expect(plugins[0]).toMatchObject({ author: 'Solo' })
    expect(plugins[0].description).toBeUndefined()
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

describe('readCommands', () => {
  it('reads <root>/.claude/commands recursively with namespaced names and never ~/.claude/projects/<id>/commands', async () => {
    copyFixture(
      'project/dot-claude/commands/ship.md',
      path.join(projectRoot, '.claude', 'commands', 'ship.md')
    )
    copyFixture(
      'project/dot-claude/commands/git/commit.md',
      path.join(projectRoot, '.claude', 'commands', 'git', 'commit.md')
    )
    const decoyPath = path.join(dirs.claudeDir, 'projects', '-tmp-demo-app', 'commands', 'decoy.md')
    fs.mkdirSync(path.dirname(decoyPath), { recursive: true })
    fs.writeFileSync(decoyPath, '# decoy')

    const cmds = await readCommands([{ id: 'p1', name: 'demo-app', path: projectRoot }])
    expect(cmds.map((c) => c.name).sort()).toEqual(['git:commit', 'ship'])
    expect(cmds.every((c) => c.scope === 'project' && c.projectName === 'demo-app')).toBe(true)
    expect(cmds.every((c) => c.projectId === 'p1')).toBe(true)
    const ship = cmds.find((c) => c.name === 'ship')!
    expect(ship.filePath).toBe(path.join(projectRoot, '.claude', 'commands', 'ship.md'))
    expect(ship.id).toBe(`project:p1:${ship.filePath}`)
    expect(ship.description).toBe('Run the release checklist')
  })

  it('user commands come from <claudeDir>/commands with scope user', async () => {
    const userCmdPath = path.join(dirs.claudeDir, 'commands', 'deploy.md')
    fs.mkdirSync(path.dirname(userCmdPath), { recursive: true })
    fs.writeFileSync(userCmdPath, '---\ndescription: Deploy the app\n---\n\nDo the deploy.')

    const cmds = await readCommands([])
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({
      name: 'deploy',
      scope: 'user',
      description: 'Deploy the app',
      filePath: userCmdPath,
      id: `user:${userCmdPath}`,
    })
    expect(cmds[0].projectId).toBeUndefined()
    expect(cmds[0].projectName).toBeUndefined()
  })

  it('skips dotfiles and non-markdown files while walking the commands directory', async () => {
    const cmdsDir = path.join(dirs.claudeDir, 'commands')
    fs.mkdirSync(cmdsDir, { recursive: true })
    fs.writeFileSync(path.join(cmdsDir, 'keep.md'), 'keep me')
    fs.writeFileSync(path.join(cmdsDir, 'notes.txt'), 'ignore me')
    fs.mkdirSync(path.join(cmdsDir, '.hidden'), { recursive: true })
    fs.writeFileSync(path.join(cmdsDir, '.hidden', 'inside.md'), 'ignore me too')
    fs.writeFileSync(path.join(cmdsDir, '.dotfile.md'), 'ignore me too')

    const cmds = await readCommands([])
    expect(cmds.map((c) => c.name)).toEqual(['keep'])
  })

  it('reads a multi-line frontmatter description (| and >) instead of showing the marker', async () => {
    const cmdsDir = path.join(dirs.claudeDir, 'commands')
    fs.mkdirSync(cmdsDir, { recursive: true })
    fs.writeFileSync(
      path.join(cmdsDir, 'literal.md'),
      '---\ndescription: |\n  First line.\n  Second line.\nname: lit\n---\nBody.'
    )
    fs.writeFileSync(
      path.join(cmdsDir, 'folded.md'),
      '---\ndescription: >\n  Folded\n  together.\n---\nBody.'
    )

    const cmds = await readCommands([])
    expect(cmds.find((c) => c.name === 'lit')?.description).toBe('First line.\nSecond line.')
    expect(cmds.find((c) => c.name === 'folded')?.description).toBe('Folded together.')
  })

  it('gives user and project commands their source', async () => {
    copyFixture(
      'project/dot-claude/commands/ship.md',
      path.join(projectRoot, '.claude', 'commands', 'ship.md')
    )
    const cmds = await readCommands([demoApp()])
    expect(cmds.find((c) => c.name === 'ship')?.source).toMatchObject({
      kind: 'project',
      id: 'project:-tmp-demo-app',
      label: 'demo-app',
    })
  })
})

describe('readCommands — plugin commands', () => {
  const pluginsDir = (): string => path.join(dirs.claudeDir, 'plugins')

  function installPlugin(name: string, manifest: Record<string, unknown> = {}): string {
    const root = path.join(pluginsDir(), 'cache', 'official', name, '2.0.0')
    writeJson(path.join(root, '.claude-plugin', 'plugin.json'), { name, ...manifest })
    return root
  }

  function writeCommand(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }

  it('names plugin commands <plugin>:<name>, namespaced like Claude Code shows them', async () => {
    const root = installPlugin('seo')
    writeCommand(
      path.join(root, 'commands', 'seo-check.md'),
      [
        '---',
        'description: Quick SEO check',
        'arguments:',
        '  - name: url',
        '    description: Page to check',
        '    required: true',
        '  - name: depth',
        '---',
        'Check the page.',
      ].join('\n')
    )
    writeCommand(path.join(root, 'commands', 'audit', 'full.md'), 'Full audit.')
    // List items at column 0, as real plugin commands write them.
    writeCommand(
      path.join(root, 'commands', 'flat.md'),
      '---\ndescription: Flat list\narguments:\n- name: file\n  required: false\n---\nBody.'
    )
    writeCommand(path.join(root, 'commands', 'renamed.md'), '---\nname: tidy\n---\nTidy.')
    writeJson(path.join(pluginsDir(), 'installed_plugins.json'), {
      version: 2,
      plugins: { 'seo@official': [{ installPath: root, version: '2.0.0' }] },
    })
    writeJson(userSettingsPath(), {
      ...readJson(userSettingsPath()),
      enabledPlugins: { 'seo@official': true },
    })

    const cmds = (await readCommands([])).filter((c) => c.scope === 'plugin')

    expect(cmds.map((c) => c.name).sort()).toEqual([
      'seo:audit:full',
      'seo:flat',
      'seo:seo-check',
      'seo:tidy',
    ])
    expect(cmds.find((c) => c.name === 'seo:flat')).toMatchObject({
      description: 'Flat list',
      arguments: [{ name: 'file', required: false }],
    })
    const check = cmds.find((c) => c.name === 'seo:seo-check')!
    expect(check).toMatchObject({
      description: 'Quick SEO check',
      source: { kind: 'plugin', id: 'plugin:seo@official', plugin: { enabled: true } },
      arguments: [{ name: 'url', description: 'Page to check', required: true }, { name: 'depth' }],
    })
    expect(check.id).toBe(`plugin:seo@official:${check.filePath}`)
    expect(check.inactive).toBeUndefined()
  })

  it('also reads the command paths plugin.json declares, and marks a disabled plugin’s commands', async () => {
    const root = installPlugin('extra', { commands: ['./more', './one.md'] })
    writeCommand(path.join(root, 'more', 'a.md'), 'A.')
    writeCommand(path.join(root, 'one.md'), 'One.')
    writeJson(path.join(pluginsDir(), 'installed_plugins.json'), {
      version: 2,
      plugins: { 'extra@official': [{ installPath: root }] },
    })

    const cmds = (await readCommands([])).filter((c) => c.scope === 'plugin')

    expect(cmds.map((c) => c.name).sort()).toEqual(['extra:a', 'extra:one'])
    expect(cmds.every((c) => c.inactive === true)).toBe(true)
  })
})

// ─── A project whose root is the home directory ──────────────────────────────
//
// `claude` run in `~` produces a project whose root IS the home directory, so
// `<root>/.claude/settings.json` and `<root>/.claude/commands` are literally
// the user's own files. Read again as project layers they were listed twice —
// every user hook once as "user" and once as "<name> · project", every user
// command twice — and `readRawSettings` concatenated the user's permissions
// and hooks with themselves.

describe('a project whose root is the home directory', () => {
  const homeProject = (): { id: string; name: string; path: string } => ({
    id: '-tmp-home',
    name: 'home',
    path: path.join(dirs.tmp, 'home'),
  })

  it('does not read the user settings file a second time as a project layer', async () => {
    const layers = await readSettingsLayers(homeProject())
    expect(layers.map((l) => l.scope)).toEqual(['user'])
    expect(layers.filter((l) => l.path === userSettingsPath())).toHaveLength(1)
  })

  it('reads <claudeDir>/settings.local.json exactly once, as that project’s local layer', async () => {
    const localPath = path.join(dirs.claudeDir, 'settings.local.json')
    writeJson(localPath, { env: { A: '1' } })

    const layers = await readSettingsLayers(homeProject())
    expect(layers.map((l) => l.scope)).toEqual(['user', 'local'])
    expect(layers.filter((l) => l.path === localPath)).toHaveLength(1)
  })

  it('lists every user hook once, not once as user and again as project', async () => {
    const groups = parseHooks(await readSettingsLayers(homeProject()))
    const preCompact = groups.find((g) => g.event === 'PreCompact')!
    expect(preCompact.rules).toHaveLength(1)
    expect(preCompact.rules[0].scope).toBe('user')
  })

  it('does not concatenate the user permissions and hooks with themselves', async () => {
    writeJson(userSettingsPath(), {
      permissions: { allow: ['Bash(ls)'], deny: [] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }] },
    })

    const raw = await readRawSettings(homeProject())
    expect(raw.permissions?.allow).toEqual(['Bash(ls)'])
    expect(raw.hooks?.Stop).toHaveLength(1)
  })

  it('lists every user command once, not once as user and again as project', async () => {
    const userCmdPath = path.join(dirs.claudeDir, 'commands', 'deploy.md')
    fs.mkdirSync(path.dirname(userCmdPath), { recursive: true })
    fs.writeFileSync(userCmdPath, '# deploy')

    const cmds = await readCommands([homeProject()])
    expect(cmds).toHaveLength(1)
    expect(cmds[0].scope).toBe('user')
  })
})

// The same home directory reached through a symlink: the transcript `cwd`
// names the link, the Claude directory names the real folder (or the other
// way round). Compared as text, the two never matched and every user hook and
// command was listed twice again.
describe('a project whose root is a symlink to the home directory', () => {
  let linkedHome = ''
  let canSymlink = true

  beforeEach(() => {
    linkedHome = path.join(dirs.tmp, 'linked-home')
    try {
      fs.symlinkSync(path.join(dirs.tmp, 'home'), linkedHome, 'dir')
    } catch {
      canSymlink = false
    }
  })

  const linkedProject = (): { id: string; name: string; path: string } => ({
    id: '-tmp-linked-home',
    name: 'linked-home',
    path: linkedHome,
  })

  it('does not read the user settings file again as a project layer', async (ctx) => {
    if (!canSymlink && process.platform === 'win32') ctx.skip()
    const layers = await readSettingsLayers(linkedProject())
    expect(layers.map((l) => l.scope)).toEqual(['user'])
  })

  it('lists every user command once', async (ctx) => {
    if (!canSymlink && process.platform === 'win32') ctx.skip()
    const userCmdPath = path.join(dirs.claudeDir, 'commands', 'deploy.md')
    fs.mkdirSync(path.dirname(userCmdPath), { recursive: true })
    fs.writeFileSync(userCmdPath, '# deploy')

    const cmds = await readCommands([linkedProject()])
    expect(cmds.map((c) => c.scope)).toEqual(['user'])
  })
})

describe('readAllAutoMemory', () => {
  function writeMemory(dirId: string, name: string, content: string): string {
    const file = path.join(dirs.claudeDir, 'projects', dirId, 'memory', name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
  }

  it('reads every project’s memory folder, naming each file’s project', async () => {
    const appIndex = writeMemory('-tmp-demo-app', 'MEMORY.md', '- [note](note.md)')
    writeMemory('-tmp-demo-app', 'note.md', 'remember this')
    // A worktree folder of the same project, merged into it by the scan.
    writeMemory('-tmp-demo-app--claude-worktrees-feat', 'MEMORY.md', '- [wt](wt.md)')
    // A folder the scan does not know (its transcripts were deleted): named
    // after the folder minus the encoded home directory, not decoded — '-'
    // could stand for '/', '.' or '-', so decoding would guess.
    writeMemory('-Users-me-Workspace-other-app', 'MEMORY.md', 'other')
    // Not memory: no folder, or not markdown.
    fs.mkdirSync(path.join(dirs.claudeDir, 'projects', '-tmp-no-memory'), { recursive: true })
    writeMemory('-tmp-demo-app', 'notes.txt', 'ignored')

    const files = await readAllAutoMemory(
      [
        {
          id: '-tmp-demo-app',
          name: 'demo-app',
          sessions: [
            { projectId: '-tmp-demo-app' },
            { projectId: '-tmp-demo-app--claude-worktrees-feat' },
          ],
        },
      ],
      '/Users/me'
    )

    // Sorted by project, then folder, with each folder's MEMORY.md index first.
    expect(files.map((f) => [f.projectName, f.label])).toEqual([
      ['demo-app', 'MEMORY'],
      ['demo-app', 'note'],
      ['demo-app', 'MEMORY'],
      ['Workspace-other-app', 'MEMORY'],
    ])
    expect(files.find((f) => f.path === appIndex)).toMatchObject({
      id: 'memory:-tmp-demo-app:MEMORY.md',
      sublabel: 'auto-memory',
      path: appIndex,
      content: '- [note](note.md)',
      projectId: '-tmp-demo-app',
    })
    expect(Number.isNaN(Date.parse(files[0].modifiedAt ?? ''))).toBe(false)
    expect(new Set(files.map((f) => f.id)).size).toBe(files.length)
  })

  it('returns nothing when there is no projects folder', async () => {
    expect(await readAllAutoMemory([])).toEqual([])
  })
})

describe('readMemoryFiles — untrusted project id', () => {
  it('refuses an id that walks out of the projects directory', async () => {
    // `projectEncodedId` comes straight from the renderer.
    await expect(readMemoryFiles('../../../etc')).rejects.toThrow(/Path traversal/)
  })

  it('still reads a normal id', async () => {
    const memoryFile = path.join(dirs.claudeDir, 'projects', '-tmp-demo-app', 'memory', 'note.md')
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true })
    fs.writeFileSync(memoryFile, 'remember this')

    const files = await readMemoryFiles('-tmp-demo-app')
    expect(files.find((f) => f.id === 'memory-note.md')?.path).toBe(memoryFile)
  })
})
