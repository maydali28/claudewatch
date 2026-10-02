import * as fs from 'fs'
import * as path from 'path'
import {
  getClaudeDir,
  getClaudeJsonPath,
  getMcpDebugLatestPath,
  getProjectsDirPath,
  getUserCommandsDirPath,
  getUserSettingsPath,
} from '@main/lib/claude-paths'
import { assertSafePath } from '@main/lib/safe-path'
import { samePath } from '@main/lib/same-path'
import {
  MANAGED_SOURCE,
  discoverPluginSources,
  effectiveEnabledPlugins,
  readManagedSettings,
  readPluginHooks,
  readPluginManifest,
  resolvePluginPath,
  sourceForLayer,
} from './config-sources'
import type {
  CommandArgument,
  ConfigScope,
  ConfigSource,
  ExtendedConfig,
  HookEventGroup,
  HookCommand,
  HookInactiveReason,
  HookScope,
  McpServerEntry,
  McpCapabilities,
  CommandEntry,
  SkillEntry,
  MemoryFile,
  ProjectRootRef,
  RawSettings,
  SettingsLayer,
} from '@shared/types/config'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Parse YAML-style frontmatter from a markdown file.
 * Returns { meta: Record<string,string>, body: string }.
 *
 * Reads top-level `key: value` pairs only; indented lines belong to the key
 * above them (a nested list such as a command's `arguments`, read by
 * `parseFrontmatterArguments`) and never become keys of their own. A block
 * value — `key: |` keeps line breaks, `key: >` folds them into spaces — is
 * read from the indented lines that follow it.
 */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  let body = content

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (fmMatch) {
    const lines = fmMatch[1].split(/\r?\n/)
    body = fmMatch[2] ?? ''
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Indented lines and list items belong to the key above them.
      if (/^\s/.test(line) || line.startsWith('-')) continue
      const colonIdx = line.indexOf(':')
      if (colonIdx <= 0) continue
      const key = line.slice(0, colonIdx).trim()
      const raw = line.slice(colonIdx + 1).trim()
      if (!key) continue

      const block = raw.match(/^([|>])[+-]?$/)
      if (block) {
        const blockLines: string[] = []
        while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) {
          blockLines.push(lines[++i].trim())
        }
        while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') blockLines.pop()
        meta[key] = block[1] === '|' ? blockLines.join('\n') : blockLines.join(' ')
        continue
      }
      meta[key] = raw.replace(/^["']|["']$/g, '')
    }
  }
  return { meta, body }
}

/**
 * The `arguments` list of a command's frontmatter — the one nested structure
 * commands use, which `parseFrontmatter` does not read:
 *
 *   arguments:
 *     - name: url
 *       description: Page to check
 *       required: true
 *
 * The items may also start at column 0 (`- name: url`), as real plugin
 * commands write them.
 *
 * Entries without a name are dropped. Returns undefined when there is no list.
 */
export function parseFrontmatterArguments(content: string): CommandArgument[] | undefined {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) return undefined
  const lines = fm[1].split(/\r?\n/)
  const start = lines.findIndex((l) => /^arguments:\s*$/.test(l))
  if (start === -1) return undefined

  const args: CommandArgument[] = []
  let current: Record<string, string> | null = null
  const flush = (): void => {
    if (current?.name) {
      args.push({
        name: current.name,
        ...(current.description ? { description: current.description } : {}),
        ...(current.required !== undefined ? { required: current.required === 'true' } : {}),
      })
    }
  }
  for (const line of lines.slice(start + 1)) {
    // List items may sit at column 0 (`- name: x`) or be indented; the next
    // top-level key ends the list.
    if (!/^\s/.test(line) && !line.startsWith('-')) break
    const item = line.match(/^\s*-\s*(.*)$/)
    const field = (item ? item[1] : line).match(/^\s*([\w-]+):\s*(.*)$/)
    if (item) {
      flush()
      current = {}
    }
    if (field && current) current[field[1]] = field[2].trim().replace(/^["']|["']$/g, '')
  }
  flush()
  return args
}

// ─── Settings layers ─────────────────────────────────────────────────────────
// Claude Code reads settings from up to four files and merges them itself.
// The project files live in the project's own `.claude/` folder, never under
// `<claudeDir>/projects/<id>/` (that directory only holds transcripts and
// `memory/`), so a project layer needs the real root from a transcript `cwd`.

async function readLayer(
  scope: ConfigScope,
  filePath: string,
  project?: ProjectRootRef
): Promise<SettingsLayer | null> {
  const settings = await readJsonFile<RawSettings>(filePath)
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return project
    ? { scope, path: filePath, settings, project }
    : { scope, path: filePath, settings }
}

/**
 * The settings files that exist, lowest precedence first: `user`, then (with a
 * project) `project` and `local`. Missing or unparseable files produce no
 * layer.
 *
 * A project whose root is the home directory — the user ran `claude` in `~` —
 * makes `<root>/.claude/settings.json` the very same file as the user
 * settings. Reading it again as a project layer listed every user hook twice
 * (once as "user", once as "<name> · project") and made `readRawSettings`
 * concatenate the user's permissions and hooks with themselves. A layer whose
 * resolved path is already a user-layer path is skipped, which also covers a
 * `CLAUDE_CONFIG_DIR` override that points `<claudeDir>` at `<root>/.claude`
 * and a root that reaches the home directory through a symlink (`samePath`
 * follows symlinks).
 *
 * `<claudeDir>/settings.local.json` is deliberately not a layer of its own:
 * it is that home-directory project's `local` file and nothing else, so it is
 * read here exactly once, under that project.
 */
export async function readSettingsLayers(project?: ProjectRootRef): Promise<SettingsLayer[]> {
  const userSettingsPath = getUserSettingsPath()
  const candidates: Array<Promise<SettingsLayer | null>> = [readLayer('user', userSettingsPath)]
  if (project) {
    const dotClaude = path.join(project.path, '.claude')
    const projectPath = path.join(dotClaude, 'settings.json')
    const localPath = path.join(dotClaude, 'settings.local.json')
    if (!samePath(projectPath, userSettingsPath)) {
      candidates.push(readLayer('project', projectPath, project))
    }
    if (!samePath(localPath, userSettingsPath)) {
      candidates.push(readLayer('local', localPath, project))
    }
  }
  return (await Promise.all(candidates)).filter((l): l is SettingsLayer => l !== null)
}

/** A value that can be spread key-wise — not null, not an array, not a scalar. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The value if it is a list, otherwise an empty one. */
function asList<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}

/**
 * Precedence local > project > user. Scalars: highest wins.
 * Lists (`permissions.allow/deny`, hooks per event): concatenated user → local.
 * Objects (`env`, `mcpServers`): key-wise, highest wins.
 *
 * Every settings file here is hand-editable JSON, so nothing about its shape
 * can be assumed. A single `"permissions": {"allow": {}}` in any one project
 * used to throw out of the spread below, and that one exception blanked the
 * Plans view for every project and failed the lint run. Values of the wrong
 * type are ignored instead.
 */
export function mergeSettingsLayers(layers: SettingsLayer[]): RawSettings {
  const out: RawSettings = {}
  for (const { settings } of layers) {
    // Ascending precedence: a later layer wins.
    const { hooks, mcpServers, env, permissions, ...scalars } = settings
    Object.assign(out, scalars)
    if (isPlainObject(env)) out.env = { ...(out.env ?? {}), ...env }
    if (isPlainObject(mcpServers)) out.mcpServers = { ...(out.mcpServers ?? {}), ...mcpServers }
    if (isPlainObject(permissions)) {
      out.permissions = {
        allow: [...asList(out.permissions?.allow), ...asList(permissions.allow)],
        deny: [...asList(out.permissions?.deny), ...asList(permissions.deny)],
      }
    }
    if (isPlainObject(hooks)) {
      const merged: NonNullable<RawSettings['hooks']> = out.hooks ?? {}
      for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) continue
        merged[event] = [...asList(merged[event]), ...entries]
      }
      out.hooks = merged
    }
  }
  return out
}

// ─── parseHooks ──────────────────────────────────────────────────────────────

/**
 * One file's hooks block: a settings layer, a plugin's hooks file or the
 * managed settings. `inactiveReason` marks rules Claude Code will not run.
 */
export interface HookLayer {
  scope: HookScope
  path: string
  hooks: unknown
  source: ConfigSource
  project?: ProjectRootRef
  inactiveReason?: HookInactiveReason
}

function hookLayerOf(layer: SettingsLayer): HookLayer {
  return {
    scope: layer.scope,
    path: layer.path,
    hooks: layer.settings.hooks,
    source: sourceForLayer(layer),
    project: layer.project,
  }
}

/**
 * Every hook rule from every layer, in layer order. Claude Code runs the
 * hooks of all sources, so nothing is replaced; each rule records the source
 * and file it came from. An id is the source id plus an index counted within
 * that single layer's rules for that event — never across the whole event
 * group. That keeps an id stable when another source later gains a rule for
 * the same event, and keeps two projects' rules for the same event distinct.
 * Source ids never contain `::` (the separator `hooks-panel.tsx` uses to
 * split a group id from a rule id), so neither does a rule id.
 */
export function parseHookLayers(layers: HookLayer[]): HookEventGroup[] {
  const byEvent = new Map<string, HookEventGroup>()
  for (const layer of layers) {
    if (!isPlainObject(layer.hooks)) continue
    for (const [event, entries] of Object.entries(layer.hooks)) {
      if (!Array.isArray(entries)) continue
      let group = byEvent.get(event)
      if (!group) {
        group = { id: event, event, rules: [] }
        byEvent.set(event, group)
      }
      const base = {
        scope: layer.scope,
        sourcePath: layer.path,
        source: layer.source,
        projectId: layer.project?.id,
        projectName: layer.project?.name,
        ...(layer.inactiveReason ? { inactiveReason: layer.inactiveReason } : {}),
      }
      let localIndex = 0
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const id = `${layer.source.id}:${event}-${localIndex}`
        if ('command' in entry) {
          // Bare HookCommand — wrap in a rule with an empty matcher
          group.rules.push({ ...base, id, matcher: '', hooks: [entry as HookCommand] })
          localIndex++
        } else if ('hooks' in entry && Array.isArray(entry.hooks)) {
          group.rules.push({
            ...base,
            id,
            matcher: (entry as { matcher?: string }).matcher ?? '',
            hooks: entry.hooks as HookCommand[],
          })
          localIndex++
        }
      }
    }
  }
  return [...byEvent.values()]
}

/** The hooks of user, project and local settings layers. See {@link parseHookLayers}. */
export function parseHooks(layers: SettingsLayer[]): HookEventGroup[] {
  return parseHookLayers(layers.map(hookLayerOf))
}

// ─── readExtendedConfig ───────────────────────────────────────────────────────

/** The hooks blocks of every installed plugin, disabled ones marked as not running. */
async function pluginHookLayers(enabledPlugins: Record<string, boolean>): Promise<HookLayer[]> {
  const plugins = await discoverPluginSources(enabledPlugins)
  const layers = await Promise.all(
    plugins.map(async (source): Promise<HookLayer | null> => {
      const read = await readPluginHooks(source)
      if (!read) return null
      return {
        scope: 'plugin',
        path: read.path,
        hooks: read.hooks,
        source,
        ...(source.plugin?.enabled ? {} : { inactiveReason: 'plugin-disabled' as const }),
      }
    })
  )
  return layers.filter((l): l is HookLayer => l !== null)
}

/**
 * Hooks from the user layers, the project and local layers of every project
 * passed, every installed plugin and the managed settings file, in that
 * order. With `allowManagedHooksOnly` set in managed settings, every other
 * rule is marked as not running (a disabled plugin keeps its own reason).
 * The panel's scalar settings come from the user layers only.
 */
export async function readExtendedConfig(projects: ProjectRootRef[]): Promise<ExtendedConfig> {
  const [userLayers, projectLayersPerRoot, managed] = await Promise.all([
    readSettingsLayers(),
    Promise.all(projects.map((p) => readSettingsLayers(p))),
    readManagedSettings(),
  ])
  const projectLayers = projectLayersPerRoot
    .flat()
    .filter((l) => l.scope === 'project' || l.scope === 'local')
  const settings = mergeSettingsLayers(userLayers)
  const plugins = await pluginHookLayers(effectiveEnabledPlugins(settings, managed?.settings))

  let hookLayers: HookLayer[] = [
    ...[...userLayers, ...projectLayers].map(hookLayerOf),
    ...plugins,
    ...(managed
      ? [
          {
            scope: 'managed' as const,
            path: managed.path,
            hooks: managed.settings.hooks,
            source: MANAGED_SOURCE,
          },
        ]
      : []),
  ]
  if (managed?.settings.allowManagedHooksOnly === true) {
    hookLayers = hookLayers.map((l) =>
      l.scope === 'managed' || l.inactiveReason ? l : { ...l, inactiveReason: 'managed-only' }
    )
  }

  return {
    hooks: parseHookLayers(hookLayers),
    sandbox: settings.sandbox,
    skipDangerousModePermissionPrompt: settings.skipDangerousModePermissionPrompt ?? false,
    disableSkillShellExecution: settings.disableSkillShellExecution ?? false,
    attribution: settings.attribution,
    plugins: settings.plugins ?? [],
    marketplaces: settings.marketplaces ?? [],
    profile: settings.profile,
    allowedChannelPlugins: settings.allowedChannelPlugins ?? [],
    env: settings.env ?? {},
  }
}

// ─── readMcps ─────────────────────────────────────────────────────────────────
// Claude Code stores MCP servers in ~/.claude.json (top-level mcpServers),
// not in ~/.claude/settings.json. We read both and merge, deduplicating by name.
// Status is parsed from ~/.claude/debug/latest which Claude Code writes on startup.

interface ClaudeJsonMcpServer {
  type?: string
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

interface ClaudeJson {
  mcpServers?: Record<string, ClaudeJsonMcpServer>
}

interface McpRuntimeStatus {
  status: 'connected' | 'failed'
  error?: string
  capabilities?: McpCapabilities
  lastSeen?: string
}

async function readMcpStatuses(): Promise<Map<string, McpRuntimeStatus>> {
  const debugLatest = getMcpDebugLatestPath()
  const log = await readTextFile(debugLatest)
  const result = new Map<string, McpRuntimeStatus>()
  if (!log) return result

  // Patterns from Claude Code debug log format
  const connectedRe =
    /(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[DEBUG\] MCP server "([^"]+)": Successfully connected/
  const capabilitiesRe = /MCP server "([^"]+)": Connection established with capabilities: (\{.+\})/
  const failedRe =
    /(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[(?:DEBUG|ERROR)\] MCP server "([^"]+)"[: ]+Connection failed[^:]*: (.+)/
  const stderrRe =
    /\[ERROR\] MCP server "([^"]+)" Server stderr: ([\s\S]+?)(?=\n\d{4}-\d{2}-\d{2}T|$)/

  for (const line of log.split('\n')) {
    let m: RegExpMatchArray | null

    m = line.match(connectedRe)
    if (m) {
      result.set(m[2], { status: 'connected', lastSeen: m[1] })
      continue
    }

    m = line.match(capabilitiesRe)
    if (m) {
      const existing = result.get(m[1])
      if (existing) {
        try {
          existing.capabilities = JSON.parse(m[2]) as McpCapabilities
        } catch {
          /* ignore */
        }
      }
      continue
    }

    m = line.match(failedRe)
    if (m) {
      const existing = result.get(m[2])
      result.set(m[2], {
        status: 'failed',
        error: existing?.error ?? m[3].trim(),
        lastSeen: m[1],
      })
    }
  }

  // Pull first stderr block per server as the human-readable error
  const stderrMatches = log.matchAll(new RegExp(stderrRe.source, 'g'))
  for (const m of stderrMatches) {
    const entry = result.get(m[1])
    if (entry?.status === 'failed' && !entry.error?.includes('\n')) {
      entry.error = m[2].trim()
    }
  }

  return result
}

type McpLevel = NonNullable<McpServerEntry['level']>

function mcpLevelFor(scope: ConfigScope): McpLevel {
  if (scope === 'project') return 'project'
  if (scope === 'local') return 'local'
  return 'global'
}

export async function readMcps(project?: ProjectRootRef): Promise<McpServerEntry[]> {
  const seen = new Set<string>()
  const entries: McpServerEntry[] = []

  const statuses = await readMcpStatuses()

  const add = (name: string, cfg: ClaudeJsonMcpServer, level: McpLevel): void => {
    // First definition wins, as before.
    if (seen.has(name)) return
    seen.add(name)
    const s = statuses.get(name)
    entries.push({
      id: name,
      name,
      type: cfg.type ?? (cfg.command ? 'stdio' : cfg.url ? 'sse' : undefined),
      command: cfg.command,
      args: cfg.args ?? [],
      url: cfg.url,
      env: cfg.env ?? {},
      level,
      status: s?.status ?? 'unknown',
      error: s?.error,
      capabilities: s?.capabilities,
      lastSeen: s?.lastSeen,
    })
  }

  // 1. ~/.claude.json (primary source for global MCPs)
  const claudeJson = await readJsonFile<ClaudeJson>(getClaudeJsonPath())
  for (const [name, cfg] of Object.entries(claudeJson?.mcpServers ?? {})) {
    add(name, cfg, 'global')
  }

  // 2. The settings layers (some setups use these). Walk the layers rather
  // than the merged object so each server keeps the level of the file that
  // defined it.
  for (const layer of await readSettingsLayers(project)) {
    for (const [name, cfg] of Object.entries(layer.settings.mcpServers ?? {})) {
      add(name, cfg, mcpLevelFor(layer.scope))
    }
  }

  return entries
}

// ─── readCommands ─────────────────────────────────────────────────────────────

/** One `.md` file found while walking a commands directory, with its path
 * segments relative to that directory, e.g. `git/commit.md` -> `['git', 'commit.md']`. */
interface MarkdownFile {
  file: string
  rel: string[]
}

/**
 * Recursively lists the `.md` files under `dir`, skipping dotfiles and
 * dot-directories. A missing directory produces an empty list.
 */
async function walkMarkdown(dir: string, rel: string[] = []): Promise<MarkdownFile[]> {
  let dirEntries: fs.Dirent[]
  try {
    dirEntries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const results: MarkdownFile[] = []
  for (const entry of dirEntries) {
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await walkMarkdown(entryPath, [...rel, entry.name])))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push({ file: entryPath, rel: [...rel, entry.name] })
    }
  }
  return results
}

interface CommandContext {
  scope: 'user' | 'project' | 'plugin'
  source: ConfigSource
  project?: ProjectRootRef
  /** `<plugin>:` for plugin commands, which Claude Code namespaces by plugin. */
  namePrefix?: string
  inactive?: boolean
}

/**
 * The display name for a namespaced file joins its directory segments and
 * base name with `:` (e.g. `git/commit.md` -> `git:commit`), unless the
 * frontmatter sets an explicit `name`, which replaces that computed name. A
 * plugin's commands get the plugin name in front (`seo:seo-check`).
 */
async function commandsFromFiles(
  files: MarkdownFile[],
  ctx: CommandContext
): Promise<CommandEntry[]> {
  const entries: CommandEntry[] = []

  for (const { file, rel } of files) {
    const content = await readTextFile(file)
    if (content === null) continue

    const stat = await fs.promises.stat(file).catch(() => null)
    const sizeBytes = stat?.size ?? Buffer.byteLength(content, 'utf-8')
    const { meta, body } = parseFrontmatter(content)
    const baseName = rel[rel.length - 1].replace(/\.md$/, '')
    const defaultName = [...rel.slice(0, -1), baseName].join(':')
    const args = parseFrontmatterArguments(content)

    entries.push({
      id: `${ctx.source.id}:${file}`,
      name: `${ctx.namePrefix ?? ''}${meta['name'] || defaultName}`,
      description: meta['description'],
      content: body.trim() || content,
      sizeBytes,
      scope: ctx.scope,
      source: ctx.source,
      filePath: file,
      ...(args && args.length > 0 ? { arguments: args } : {}),
      ...(ctx.inactive ? { inactive: true as const } : {}),
      projectId: ctx.project?.id,
      projectName: ctx.project?.name,
    })
  }

  return entries
}

/** Every command markdown file under `dir` (recursively). */
async function readCommandsFromDir(dir: string, ctx: CommandContext): Promise<CommandEntry[]> {
  return commandsFromFiles(await walkMarkdown(dir), ctx)
}

/**
 * A plugin's command files: its `commands/` folder plus every path its
 * `plugin.json` lists under `commands` (folders or single `.md` files), each
 * resolved inside the plugin folder. A file reached twice is read once.
 */
async function pluginCommandFiles(root: string): Promise<MarkdownFile[]> {
  const manifest = await readPluginManifest(root)
  const declared =
    typeof manifest.commands === 'string'
      ? [manifest.commands]
      : Array.isArray(manifest.commands)
        ? manifest.commands.filter((c): c is string => typeof c === 'string')
        : []

  const files: MarkdownFile[] = []
  for (const entry of ['commands', ...declared]) {
    const resolved = await resolvePluginPath(root, entry)
    if (!resolved) continue
    const stat = await fs.promises.stat(resolved).catch(() => null)
    if (stat?.isDirectory()) files.push(...(await walkMarkdown(resolved)))
    else if (stat?.isFile() && resolved.endsWith('.md')) {
      files.push({ file: resolved, rel: [path.basename(resolved)] })
    }
  }
  const seen = new Set<string>()
  return files.filter((f) => !seen.has(f.file) && !!seen.add(f.file))
}

/** Installed plugins, enabled as the user and managed settings say. */
async function currentPluginSources(): Promise<ConfigSource[]> {
  const [userLayers, managed] = await Promise.all([readSettingsLayers(), readManagedSettings()])
  return discoverPluginSources(
    effectiveEnabledPlugins(mergeSettingsLayers(userLayers), managed?.settings)
  )
}

/**
 * User commands from `getUserCommandsDirPath()`, each project's
 * `<root>/.claude/commands` and every installed plugin's commands,
 * recursively. Never `<claudeDir>/projects/<id>/commands` — that directory
 * only holds transcripts and `memory/`, never commands.
 *
 * A project rooted at the home directory shares its commands directory with
 * the user one, and every command in it was listed twice. Such a project is
 * skipped here, exactly as its settings layer is in `readSettingsLayers`.
 * A disabled plugin's commands are listed, marked `inactive`.
 */
export async function readCommands(projects: ProjectRootRef[]): Promise<CommandEntry[]> {
  const userCommandsDir = getUserCommandsDirPath()
  const [userCommands, projectCommands, pluginCommands] = await Promise.all([
    readCommandsFromDir(userCommandsDir, {
      scope: 'user',
      source: sourceForLayer({ scope: 'user', path: '', settings: {} }),
    }),
    Promise.all(
      projects
        .map((project) => ({ project, dir: path.join(project.path, '.claude', 'commands') }))
        .filter(({ dir }) => !samePath(dir, userCommandsDir))
        .map(({ project, dir }) =>
          readCommandsFromDir(dir, {
            scope: 'project',
            source: sourceForLayer({ scope: 'project', path: '', settings: {}, project }),
            project,
          })
        )
    ),
    currentPluginSources().then((plugins) =>
      Promise.all(
        plugins.map(async (source) =>
          source.root
            ? commandsFromFiles(await pluginCommandFiles(source.root), {
                scope: 'plugin',
                source,
                namePrefix: `${source.label}:`,
                inactive: source.plugin?.enabled === false,
              })
            : []
        )
      )
    ),
  ])
  return [...userCommands, ...projectCommands.flat(), ...pluginCommands.flat()]
}

// ─── readSkills ───────────────────────────────────────────────────────────────

export async function readSkillsFromDir(skillsDir: string): Promise<SkillEntry[]> {
  let skillDirs: string[] = []
  try {
    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
    skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }

  const skills: SkillEntry[] = []

  for (const dirName of skillDirs) {
    const skillFile = path.join(skillsDir, dirName, 'SKILL.md')
    const content = await readTextFile(skillFile)
    if (content === null) continue

    const stat = await fs.promises.stat(skillFile).catch(() => null)
    const sizeBytes = stat?.size ?? Buffer.byteLength(content, 'utf-8')
    const { meta, body } = parseFrontmatter(content)

    const { name, displayName, description, ...extraMeta } = meta

    skills.push({
      id: dirName,
      name: name ?? dirName,
      displayName: displayName ?? name ?? dirName,
      description: description,
      metadata: extraMeta,
      body: body.trim(),
      sizeBytes,
    })
  }

  return skills
}

export async function readSkills(): Promise<SkillEntry[]> {
  const claudeDir = getClaudeDir()
  return readSkillsFromDir(path.join(claudeDir, 'skills'))
}

// ─── readMemoryFiles ──────────────────────────────────────────────────────────

/**
 * The user `CLAUDE.md`, the project's `CLAUDE.md` (read from the project's
 * real root, so only when one is known), and the auto-memory files, which
 * Claude Code keeps under `<claudeDir>/projects/<id>/memory`.
 */
export async function readMemoryFiles(
  projectEncodedId?: string,
  project?: ProjectRootRef
): Promise<MemoryFile[]> {
  const claudeDir = getClaudeDir()
  const files: MemoryFile[] = []

  // 1. Global CLAUDE.md
  const globalClaudeMd = path.join(claudeDir, 'CLAUDE.md')
  if (await fileExists(globalClaudeMd)) {
    const content = await readTextFile(globalClaudeMd)
    const stat = await fs.promises.stat(globalClaudeMd).catch(() => null)
    files.push({
      id: 'global-claude-md',
      label: 'CLAUDE.md',
      sublabel: 'global',
      path: globalClaudeMd,
      content: content ?? undefined,
      sizeBytes: stat?.size,
    })
  }

  // 2. Project CLAUDE.md, from the project root
  if (project) {
    const projectClaudeMd = path.join(project.path, 'CLAUDE.md')
    if (await fileExists(projectClaudeMd)) {
      const content = await readTextFile(projectClaudeMd)
      const stat = await fs.promises.stat(projectClaudeMd).catch(() => null)
      files.push({
        id: 'project-claude-md',
        label: 'CLAUDE.md',
        sublabel: 'project',
        path: projectClaudeMd,
        content: content ?? undefined,
        sizeBytes: stat?.size,
      })
    }
  }

  // 3. Auto-memory files
  if (projectEncodedId) {
    // `projectEncodedId` is renderer-supplied; `assertSafePath` rejects an id
    // like `../../x` instead of joining it and reading outside the projects
    // directory.
    const memoryDir = assertSafePath(getProjectsDirPath(), projectEncodedId, 'memory')
    try {
      const memEntries = await fs.promises.readdir(memoryDir, { withFileTypes: true })
      for (const entry of memEntries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const memPath = path.join(memoryDir, entry.name)
        const content = await readTextFile(memPath)
        const stat = await fs.promises.stat(memPath).catch(() => null)
        files.push({
          id: `memory-${entry.name}`,
          label: entry.name.replace(/\.md$/, ''),
          sublabel: 'auto-memory',
          path: memPath,
          content: content ?? undefined,
          sizeBytes: stat?.size,
        })
      }
    } catch {
      // memory dir doesn't exist — skip
    }
  }

  return files
}

// ─── readRawSettings ──────────────────────────────────────────────────────────
// Exported for use by lint rules that need the merged settings object

export async function readRawSettings(project?: ProjectRootRef): Promise<RawSettings> {
  return mergeSettingsLayers(await readSettingsLayers(project))
}
