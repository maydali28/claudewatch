import * as fs from 'fs'
import * as path from 'path'
import { getManagedSettingsPath, getPluginsDirPath } from '@main/lib/claude-paths'
import { createLogger } from '@main/lib/logger'
import type { ConfigSource, RawSettings, SettingsLayer } from '@shared/types/config'

// Where hooks, commands and skills come from besides the user and project
// settings layers: installed plugins (from a marketplace, or synced from the
// claude.ai account) and the administrator's managed settings file. Every
// file read here is written by Claude Code or by hand, so nothing about its
// shape is assumed; anything unreadable is skipped, never thrown.

const log = createLogger('ConfigSources')

type Hooks = NonNullable<RawSettings['hooks']>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'))
  } catch {
    return null
  }
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(p)
  } catch {
    return null
  }
}

/** `child` is `parent` or lies inside it (both already resolved). */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * The real path of a plugin folder, or null when it does not exist or
 * resolves outside the plugins directory. Install paths come from JSON files
 * on disk; following one out of `<claudeDir>/plugins` would let a hand-edited
 * file make the app read arbitrary folders.
 */
async function pluginRoot(candidate: string, pluginsReal: string): Promise<string | null> {
  const real = await realpathOrNull(candidate)
  if (!real || !isInside(real, pluginsReal)) return null
  try {
    return (await fs.promises.stat(real)).isDirectory() ? real : null
  } catch {
    return null
  }
}

// ─── Settings layers ─────────────────────────────────────────────────────────

/** The source of a user, project or local settings layer. */
export function sourceForLayer(layer: SettingsLayer): ConfigSource {
  if (layer.scope === 'user') return { kind: 'user', id: 'user', label: 'Global' }
  if (!layer.project) return { kind: layer.scope, id: layer.scope, label: layer.scope }
  return {
    kind: layer.scope,
    id: `${layer.scope}:${layer.project.id}`,
    label: layer.project.name,
    root: layer.project.path,
    projectId: layer.project.id,
    projectName: layer.project.name,
  }
}

export const MANAGED_SOURCE: ConfigSource = { kind: 'managed', id: 'managed', label: 'Managed' }

// ─── Managed settings ────────────────────────────────────────────────────────

export async function readManagedSettings(): Promise<{
  path: string
  settings: RawSettings
} | null> {
  const filePath = getManagedSettingsPath()
  const settings = await readJson(filePath)
  return isPlainObject(settings) ? { path: filePath, settings: settings as RawSettings } : null
}

// ─── Plugins ─────────────────────────────────────────────────────────────────

/**
 * `enabledPlugins` as Claude Code applies it: the user settings, overridden
 * key by key by the managed settings. Non-boolean values are ignored.
 */
export function effectiveEnabledPlugins(
  user: RawSettings,
  managed?: RawSettings | null
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const layer of [user, managed]) {
    if (!layer || !isPlainObject(layer.enabledPlugins)) continue
    for (const [key, value] of Object.entries(layer.enabledPlugins)) {
      if (typeof value === 'boolean') out[key] = value
    }
  }
  return out
}

interface InstalledPlugin {
  installPath?: unknown
  version?: unknown
}

async function marketplacePlugins(
  pluginsReal: string,
  enabledPlugins: Record<string, boolean>
): Promise<ConfigSource[]> {
  const file = await readJson(path.join(pluginsReal, 'installed_plugins.json'))
  const entries = isPlainObject(file) && isPlainObject(file.plugins) ? file.plugins : {}

  const sources: Array<ConfigSource | null> = await Promise.all(
    Object.entries(entries).map(async ([key, installs]) => {
      const at = key.lastIndexOf('@')
      if (at <= 0 || !Array.isArray(installs)) return null
      const name = key.slice(0, at)
      const marketplace = key.slice(at + 1)
      // One install per plugin is what Claude Code loads; a later entry
      // replaces an earlier one, so take the last readable one.
      for (const install of [...installs].reverse() as InstalledPlugin[]) {
        if (!isPlainObject(install) || typeof install.installPath !== 'string') continue
        const root = await pluginRoot(install.installPath, pluginsReal)
        if (!root) {
          log.warn(
            `Skipping plugin ${key}: install folder missing or outside the plugins directory`
          )
          continue
        }
        return {
          kind: 'plugin' as const,
          id: `plugin:${key}`,
          label: name,
          root,
          plugin: {
            name,
            marketplace,
            ...(typeof install.version === 'string' ? { version: install.version } : {}),
            origin: 'marketplace' as const,
            enabled: enabledPlugins[key] === true,
          },
        }
      }
      return null
    })
  )
  return sources.filter((s): s is ConfigSource => s !== null)
}

async function syncedPlugins(pluginsReal: string): Promise<ConfigSource[]> {
  const syncedDir = path.join(pluginsReal, 'synced')
  let buckets: string[]
  try {
    buckets = await fs.promises.readdir(syncedDir)
  } catch {
    return []
  }

  const perBucket = await Promise.all(
    buckets
      .filter((b) => !b.startsWith('.'))
      .map(async (bucket): Promise<ConfigSource[]> => {
        const bucketDir = path.join(syncedDir, bucket)
        const manifest = await readJson(path.join(bucketDir, 'manifest.json'))
        if (!isPlainObject(manifest) || !Array.isArray(manifest.plugins)) return []
        const found = await Promise.all(
          manifest.plugins.map(async (entry): Promise<ConfigSource | null> => {
            if (!isPlainObject(entry) || typeof entry.name !== 'string' || !entry.name) return null
            if (entry.name.includes('/') || entry.name.includes('\\')) return null
            const root = await pluginRoot(path.join(bucketDir, entry.name), pluginsReal)
            if (!root) return null
            return {
              kind: 'plugin',
              id: `plugin:${entry.name}@claude.ai`,
              label: entry.name,
              root,
              plugin: {
                name: entry.name,
                ...(typeof entry.version === 'string' ? { version: entry.version } : {}),
                origin: 'claude.ai',
                enabled: true,
              },
            }
          })
        )
        return found.filter((s): s is ConfigSource => s !== null)
      })
  )
  return perBucket.flat()
}

/**
 * Every installed plugin, sorted by name: marketplace installs (only the
 * version Claude Code recorded in `installed_plugins.json`, never older
 * cached ones), marked enabled from `enabledPlugins`, and plugins synced from
 * the claude.ai account, which are always enabled.
 */
export async function discoverPluginSources(
  enabledPlugins: Record<string, boolean>
): Promise<ConfigSource[]> {
  const pluginsReal = await realpathOrNull(getPluginsDirPath())
  if (!pluginsReal) return []
  const [marketplace, synced] = await Promise.all([
    marketplacePlugins(pluginsReal, enabledPlugins),
    syncedPlugins(pluginsReal),
  ])
  return [...marketplace, ...synced].sort((a, b) =>
    a.label.toLowerCase().localeCompare(b.label.toLowerCase())
  )
}

/** A plugin's `.claude-plugin/plugin.json`, or an empty object. */
export async function readPluginManifest(root: string): Promise<Record<string, unknown>> {
  const manifest = await readJson(path.join(root, '.claude-plugin', 'plugin.json'))
  return isPlainObject(manifest) ? manifest : {}
}

/**
 * A path a plugin declares in `plugin.json`, resolved against its root, or
 * null when it does not exist or leaves the plugin folder.
 */
export async function resolvePluginPath(root: string, declared: string): Promise<string | null> {
  const candidate = path.resolve(root, declared)
  const [real, rootReal] = await Promise.all([realpathOrNull(candidate), realpathOrNull(root)])
  if (!real || !rootReal || !isInside(real, rootReal)) return null
  return candidate
}

/** A hooks file's event map: `{hooks: {...}}` (the usual shape) or the event map itself. */
function hooksOf(value: unknown): Hooks | null {
  if (!isPlainObject(value)) return null
  const block = isPlainObject(value.hooks) ? value.hooks : value
  return block as Hooks
}

/**
 * A plugin's hooks: the `hooks` entry of `plugin.json` (a path relative to
 * the plugin root, or the hooks inline), else `hooks/hooks.json`. Hook files
 * for other tools (`hooks-cursor.json`, …) are never read.
 */
export async function readPluginHooks(
  source: ConfigSource
): Promise<{ path: string; hooks: Hooks } | null> {
  if (!source.root) return null
  const manifest = await readPluginManifest(source.root)

  if (isPlainObject(manifest.hooks)) {
    const hooks = hooksOf(manifest.hooks)
    return hooks ? { path: path.join(source.root, '.claude-plugin', 'plugin.json'), hooks } : null
  }

  const declared = typeof manifest.hooks === 'string' ? manifest.hooks : 'hooks/hooks.json'
  const file = await resolvePluginPath(source.root, declared)
  if (!file) return null
  const hooks = hooksOf(await readJson(file))
  return hooks ? { path: file, hooks } : null
}
