import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const dirs = vi.hoisted(() => ({ tmp: '', claudeDir: '', managed: '' }))
vi.mock('@main/lib/claude-paths', async () => {
  const p = await import('path')
  return {
    getClaudeDir: () => dirs.claudeDir,
    getPluginsDirPath: () => p.join(dirs.claudeDir, 'plugins'),
    getManagedSettingsPath: () => dirs.managed,
  }
})

import {
  discoverPluginSources,
  effectiveEnabledPlugins,
  readManagedSettings,
  readPluginHooks,
  sourceForLayer,
} from './config-sources'

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value))
}

const pluginsDir = (): string => path.join(dirs.claudeDir, 'plugins')

/** A marketplace install in the versioned cache, recorded in installed_plugins.json. */
function installPlugin(name: string, marketplace: string, version: string): string {
  const root = path.join(pluginsDir(), 'cache', marketplace, name, version)
  writeJson(path.join(root, '.claude-plugin', 'plugin.json'), { name, version })
  return root
}

function writeInstalled(entries: Record<string, Array<Record<string, unknown>>>): void {
  writeJson(path.join(pluginsDir(), 'installed_plugins.json'), { version: 2, plugins: entries })
}

beforeEach(() => {
  dirs.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'config-sources-'))
  dirs.claudeDir = path.join(dirs.tmp, 'home', '.claude')
  dirs.managed = path.join(dirs.tmp, 'managed', 'managed-settings.json')
  fs.mkdirSync(dirs.claudeDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(dirs.tmp, { recursive: true, force: true })
})

describe('sourceForLayer', () => {
  it('gives settings layers the ids and labels the rest of the app already uses', () => {
    const project = { id: 'p1', name: 'demo', path: '/r' }
    expect(sourceForLayer({ scope: 'user', path: '/u', settings: {} })).toEqual({
      kind: 'user',
      id: 'user',
      label: 'Global',
    })
    expect(sourceForLayer({ scope: 'project', path: '/p', settings: {}, project })).toEqual({
      kind: 'project',
      id: 'project:p1',
      label: 'demo',
      root: '/r',
      projectId: 'p1',
      projectName: 'demo',
    })
    expect(sourceForLayer({ scope: 'local', path: '/l', settings: {}, project }).id).toBe(
      'local:p1'
    )
  })
})

describe('effectiveEnabledPlugins', () => {
  it('lets managed settings override the user settings, key by key', () => {
    expect(
      effectiveEnabledPlugins(
        { enabledPlugins: { 'a@m': true, 'b@m': true } },
        { enabledPlugins: { 'b@m': false, 'c@m': true } }
      )
    ).toEqual({ 'a@m': true, 'b@m': false, 'c@m': true })
  })

  it('ignores enabledPlugins values that are not booleans', () => {
    expect(
      effectiveEnabledPlugins({ enabledPlugins: { 'a@m': 'yes' as unknown as boolean } })
    ).toEqual({})
  })
})

describe('discoverPluginSources', () => {
  it('reads each marketplace plugin from its installPath, enabled only when enabledPlugins says so', async () => {
    const superpowers = installPlugin('superpowers', 'official', '6.4.1')
    installPlugin('superpowers', 'official', '6.3.0') // an older cached version, never read
    const design = installPlugin('frontend-design', 'official', 'ab024cdc')
    writeInstalled({
      'superpowers@official': [{ scope: 'user', installPath: superpowers, version: '6.4.1' }],
      'frontend-design@official': [{ scope: 'user', installPath: design, version: 'ab024cdc' }],
    })

    const sources = await discoverPluginSources({ 'superpowers@official': true })

    expect(sources.map((s) => s.label)).toEqual(['frontend-design', 'superpowers'])
    expect(sources[1]).toEqual({
      kind: 'plugin',
      id: 'plugin:superpowers@official',
      label: 'superpowers',
      root: fs.realpathSync(superpowers),
      plugin: {
        name: 'superpowers',
        marketplace: 'official',
        version: '6.4.1',
        origin: 'marketplace',
        enabled: true,
      },
    })
    expect(sources[0].plugin?.enabled).toBe(false)
  })

  it('lists claude.ai-synced plugins from their manifest, always enabled', async () => {
    const bucket = path.join(pluginsDir(), 'synced', 'abc_def')
    writeJson(path.join(bucket, 'manifest.json'), {
      plugins: [
        { name: 'searchfit-seo', version: '0041', marketplaceName: 'knowledge-work-plugins' },
      ],
    })
    writeJson(path.join(bucket, 'searchfit-seo', '.claude-plugin', 'plugin.json'), {
      name: 'searchfit-seo',
    })

    const [seo] = await discoverPluginSources({})

    expect(seo).toMatchObject({
      kind: 'plugin',
      id: 'plugin:searchfit-seo@claude.ai',
      label: 'searchfit-seo',
      root: fs.realpathSync(path.join(bucket, 'searchfit-seo')),
      plugin: { name: 'searchfit-seo', version: '0041', origin: 'claude.ai', enabled: true },
    })
  })

  it('skips an install whose folder is missing or outside the plugins directory', async () => {
    const outside = path.join(dirs.tmp, 'elsewhere', 'evil')
    fs.mkdirSync(outside, { recursive: true })
    writeInstalled({
      'gone@m': [{ installPath: path.join(pluginsDir(), 'cache', 'm', 'gone', '1') }],
      'evil@m': [{ installPath: outside }],
    })

    expect(await discoverPluginSources({ 'gone@m': true, 'evil@m': true })).toEqual([])
  })

  it('returns nothing, without throwing, when the plugin files are missing or malformed', async () => {
    expect(await discoverPluginSources({})).toEqual([])

    fs.mkdirSync(pluginsDir(), { recursive: true })
    fs.writeFileSync(path.join(pluginsDir(), 'installed_plugins.json'), '{ not json')
    writeJson(path.join(pluginsDir(), 'synced', 'x', 'manifest.json'), { plugins: 'nope' })
    expect(await discoverPluginSources({})).toEqual([])
  })
})

describe('readPluginHooks', () => {
  const sourceAt = (root: string) => ({
    kind: 'plugin' as const,
    id: 'plugin:p@m',
    label: 'p',
    root,
  })
  const hooksBlock = {
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'run.sh' }] }],
  }

  it('reads hooks/hooks.json by default', async () => {
    const root = installPlugin('p', 'm', '1')
    writeJson(path.join(root, 'hooks', 'hooks.json'), { hooks: hooksBlock })

    const read = await readPluginHooks(sourceAt(root))

    expect(read).toEqual({ path: path.join(root, 'hooks', 'hooks.json'), hooks: hooksBlock })
  })

  it('follows a hooks path declared in plugin.json', async () => {
    const root = installPlugin('p', 'm', '1')
    writeJson(path.join(root, '.claude-plugin', 'plugin.json'), {
      name: 'p',
      hooks: './config/h.json',
    })
    writeJson(path.join(root, 'config', 'h.json'), { hooks: hooksBlock })

    expect((await readPluginHooks(sourceAt(root)))?.path).toBe(path.join(root, 'config', 'h.json'))
  })

  it('reads hooks declared inline in plugin.json', async () => {
    const root = installPlugin('p', 'm', '1')
    const manifest = path.join(root, '.claude-plugin', 'plugin.json')
    writeJson(manifest, { name: 'p', hooks: { hooks: hooksBlock } })

    expect(await readPluginHooks(sourceAt(root))).toEqual({ path: manifest, hooks: hooksBlock })
  })

  it('refuses a declared hooks path that leaves the plugin folder, and returns null without hooks', async () => {
    const root = installPlugin('p', 'm', '1')
    writeJson(path.join(root, '.claude-plugin', 'plugin.json'), {
      name: 'p',
      hooks: '../../x.json',
    })
    expect(await readPluginHooks(sourceAt(root))).toBeNull()

    const bare = installPlugin('q', 'm', '1')
    expect(await readPluginHooks(sourceAt(bare))).toBeNull()
  })
})

describe('readManagedSettings', () => {
  it('returns null when there is no managed settings file', async () => {
    expect(await readManagedSettings()).toBeNull()
  })

  it('reads the managed settings file', async () => {
    writeJson(dirs.managed, { allowManagedHooksOnly: true, hooks: {} })
    expect(await readManagedSettings()).toEqual({
      path: dirs.managed,
      settings: { allowManagedHooksOnly: true, hooks: {} },
    })
  })
})
