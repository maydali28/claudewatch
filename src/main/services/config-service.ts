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
import type {
  ConfigScope,
  ExtendedConfig,
  HookEventGroup,
  HookCommand,
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
 * Only handles simple key: value pairs (no nested structures).
 */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  let body = content

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (fmMatch) {
    const rawMeta = fmMatch[1]
    body = fmMatch[2] ?? ''
    for (const line of rawMeta.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim()
        const val = line
          .slice(colonIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
        if (key) meta[key] = val
      }
    }
  }
  return { meta, body }
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
 * Every hook rule from every layer, in layer order. Claude Code runs the
 * hooks of all scopes, so nothing is replaced; each rule records the scope
 * and file it came from. Ids are built from the scope, the project id (when
 * the layer belongs to a project) and an index counted within that single
 * layer's rules for that event — never across the whole event group. That
 * keeps an id stable when another project or scope later gains a rule for
 * the same event, and keeps two projects' rules for the same event distinct.
 * Segments are joined so the id never contains `::` (the separator
 * `hooks-panel.tsx` uses to split a group id from a rule id).
 */
export function parseHooks(layers: SettingsLayer[]): HookEventGroup[] {
  const byEvent = new Map<string, HookEventGroup>()
  for (const layer of layers) {
    for (const [event, entries] of Object.entries(layer.settings.hooks ?? {})) {
      if (!Array.isArray(entries)) continue
      let group = byEvent.get(event)
      if (!group) {
        group = { id: event, event, rules: [] }
        byEvent.set(event, group)
      }
      const base = {
        scope: layer.scope,
        sourcePath: layer.path,
        projectId: layer.project?.id,
        projectName: layer.project?.name,
      }
      let localIndex = 0
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const idSegments = [layer.scope, layer.project?.id, `${event}-${localIndex}`].filter(
          (s): s is string => s !== undefined
        )
        const id = idSegments.join(':')
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

// ─── readExtendedConfig ───────────────────────────────────────────────────────

/**
 * Hooks from the user layers plus the project and local layers of every
 * project passed. The panel's scalar settings come from the user layers only.
 */
export async function readExtendedConfig(projects: ProjectRootRef[]): Promise<ExtendedConfig> {
  const userLayers = await readSettingsLayers()
  const projectLayers = (await Promise.all(projects.map((p) => readSettingsLayers(p))))
    .flat()
    .filter((l) => l.scope === 'project' || l.scope === 'local')
  const settings = mergeSettingsLayers(userLayers)

  return {
    hooks: parseHooks([...userLayers, ...projectLayers]),
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

/**
 * Reads every command markdown file under `dir` (recursively). The display
 * name for a namespaced file joins its directory segments and base name with
 * `:` (e.g. `git/commit.md` -> `git:commit`), unless the frontmatter sets an
 * explicit `name`, which replaces that computed name entirely.
 */
async function readCommandsFromDir(
  dir: string,
  scope: 'user' | 'project',
  project?: ProjectRootRef
): Promise<CommandEntry[]> {
  const files = await walkMarkdown(dir)
  const entries: CommandEntry[] = []

  for (const { file, rel } of files) {
    const content = await readTextFile(file)
    if (content === null) continue

    const stat = await fs.promises.stat(file).catch(() => null)
    const sizeBytes = stat?.size ?? Buffer.byteLength(content, 'utf-8')
    const { meta, body } = parseFrontmatter(content)
    const baseName = rel[rel.length - 1].replace(/\.md$/, '')
    const defaultName = [...rel.slice(0, -1), baseName].join(':')

    entries.push({
      id: `${scope}:${file}`,
      name: meta['name'] ?? defaultName,
      description: meta['description'],
      content: body.trim() || content,
      sizeBytes,
      scope,
      filePath: file,
      projectId: project?.id,
      projectName: project?.name,
    })
  }

  return entries
}

/**
 * User commands from `getUserCommandsDirPath()`, then each project's
 * `<root>/.claude/commands`, recursively. Never
 * `<claudeDir>/projects/<id>/commands` — that directory only holds
 * transcripts and `memory/`, never commands.
 *
 * A project rooted at the home directory shares its commands directory with
 * the user one, and every command in it was listed twice. Such a project is
 * skipped here, exactly as its settings layer is in `readSettingsLayers`.
 */
export async function readCommands(projects: ProjectRootRef[]): Promise<CommandEntry[]> {
  const userCommandsDir = getUserCommandsDirPath()
  const userCommands = await readCommandsFromDir(userCommandsDir, 'user')
  const projectCommands = await Promise.all(
    projects
      .map((project) => ({ project, dir: path.join(project.path, '.claude', 'commands') }))
      .filter(({ dir }) => !samePath(dir, userCommandsDir))
      .map(({ project, dir }) => readCommandsFromDir(dir, 'project', project))
  )
  return [...userCommands, ...projectCommands.flat()]
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
