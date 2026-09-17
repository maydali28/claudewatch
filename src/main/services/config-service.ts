import * as fs from 'fs'
import * as path from 'path'
import {
  getClaudeDir,
  getClaudeJsonPath,
  getMcpDebugLatestPath,
  getProjectsDirPath,
  getUserSettingsLocalPath,
  getUserSettingsPath,
} from '@main/lib/claude-paths'
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
 * The settings files that exist, lowest precedence first: `user`,
 * `user-local`, then (with a project) `project` and `local`. Missing or
 * unparseable files produce no layer.
 */
export async function readSettingsLayers(project?: ProjectRootRef): Promise<SettingsLayer[]> {
  const candidates: Array<Promise<SettingsLayer | null>> = [
    readLayer('user', getUserSettingsPath()),
    readLayer('user-local', getUserSettingsLocalPath()),
  ]
  if (project) {
    const dotClaude = path.join(project.path, '.claude')
    candidates.push(readLayer('project', path.join(dotClaude, 'settings.json'), project))
    candidates.push(readLayer('local', path.join(dotClaude, 'settings.local.json'), project))
  }
  return (await Promise.all(candidates)).filter((l): l is SettingsLayer => l !== null)
}

/**
 * Precedence local > project > user-local > user. Scalars: highest wins.
 * Lists (`permissions.allow/deny`, hooks per event): concatenated user → local.
 * Objects (`env`, `mcpServers`): key-wise, highest wins.
 */
export function mergeSettingsLayers(layers: SettingsLayer[]): RawSettings {
  const out: RawSettings = {}
  for (const { settings } of layers) {
    // Ascending precedence: a later layer wins.
    const { hooks, mcpServers, env, permissions, ...scalars } = settings
    Object.assign(out, scalars)
    if (env) out.env = { ...(out.env ?? {}), ...env }
    if (mcpServers) out.mcpServers = { ...(out.mcpServers ?? {}), ...mcpServers }
    if (permissions) {
      out.permissions = {
        allow: [...(out.permissions?.allow ?? []), ...(permissions.allow ?? [])],
        deny: [...(out.permissions?.deny ?? []), ...(permissions.deny ?? [])],
      }
    }
    if (hooks) {
      const merged: NonNullable<RawSettings['hooks']> = out.hooks ?? {}
      for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) continue
        merged[event] = [...(merged[event] ?? []), ...entries]
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

export async function readCommands(projectEncodedId?: string): Promise<CommandEntry[]> {
  const claudeDir = getClaudeDir()
  const dirs: string[] = [path.join(claudeDir, 'commands')]

  if (projectEncodedId) {
    dirs.push(path.join(claudeDir, 'projects', projectEncodedId, 'commands'))
  }

  const entries: CommandEntry[] = []

  for (const dir of dirs) {
    let files: string[] = []
    try {
      const dirEntries = await fs.promises.readdir(dir, { withFileTypes: true })
      files = dirEntries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
    } catch {
      continue
    }

    for (const file of files) {
      const filePath = path.join(dir, file)
      const content = await readTextFile(filePath)
      if (content === null) continue

      const stat = await fs.promises.stat(filePath).catch(() => null)
      const sizeBytes = stat?.size ?? Buffer.byteLength(content, 'utf-8')
      const { meta, body } = parseFrontmatter(content)
      const baseName = file.replace(/\.md$/, '')

      entries.push({
        id: `${dir}:${baseName}`,
        name: meta['name'] ?? baseName,
        description: meta['description'],
        content: body.trim() || content,
        sizeBytes,
      })
    }
  }

  return entries
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
    const memoryDir = path.join(getProjectsDirPath(), projectEncodedId, 'memory')
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
