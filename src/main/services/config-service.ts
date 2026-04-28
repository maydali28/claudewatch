import * as fs from 'fs'
import * as path from 'path'
import { getClaudeDir } from './project-scanner'
import type {
  ExtendedConfig,
  HookEventGroup,
  HookCommand,
  McpServerEntry,
  McpCapabilities,
  CommandEntry,
  SkillEntry,
  MemoryFile,
  RawSettings,
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

/**
 * Read and merge settings.json files. Project-level overrides global.
 */
async function readSettings(claudeDir: string, projectEncodedId?: string): Promise<RawSettings> {
  const globalPath = path.join(claudeDir, 'settings.json')
  const global = (await readJsonFile<RawSettings>(globalPath)) ?? {}

  if (!projectEncodedId) return global

  const projectPath = path.join(claudeDir, 'projects', projectEncodedId, 'settings.json')
  const project = (await readJsonFile<RawSettings>(projectPath)) ?? {}

  // Shallow merge — project values override global
  return {
    ...global,
    ...project,
    hooks: { ...global.hooks, ...project.hooks },
    mcpServers: { ...global.mcpServers, ...project.mcpServers },
    env: { ...global.env, ...project.env },
    permissions: {
      allow: [...(global.permissions?.allow ?? []), ...(project.permissions?.allow ?? [])],
      deny: [...(global.permissions?.deny ?? []), ...(project.permissions?.deny ?? [])],
    },
  }
}

// ─── parseHooks ──────────────────────────────────────────────────────────────

function parseHooks(rawHooks: RawSettings['hooks'] = {}): HookEventGroup[] {
  const groups: HookEventGroup[] = []

  for (const [event, entries] of Object.entries(rawHooks)) {
    const rules: HookEventGroup['rules'] = []

    for (const entry of entries) {
      if ('command' in entry) {
        // Bare HookCommand — wrap in a rule with empty matcher
        rules.push({
          id: `${event}-bare-${rules.length}`,
          matcher: '',
          hooks: [entry as HookCommand],
        })
      } else if ('hooks' in entry && Array.isArray(entry.hooks)) {
        rules.push({
          id: `${event}-${rules.length}`,
          matcher: (entry as { matcher?: string }).matcher ?? '',
          hooks: entry.hooks as HookCommand[],
        })
      }
    }

    groups.push({ id: event, event, rules })
  }

  return groups
}

// ─── readExtendedConfig ───────────────────────────────────────────────────────

export async function readExtendedConfig(projectEncodedId?: string): Promise<ExtendedConfig> {
  const claudeDir = getClaudeDir()
  const settings = await readSettings(claudeDir, projectEncodedId)

  return {
    hooks: parseHooks(settings.hooks),
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

// ─── readHooks ────────────────────────────────────────────────────────────────

export async function readHooks(projectEncodedId?: string): Promise<HookEventGroup[]> {
  const claudeDir = getClaudeDir()
  const settings = await readSettings(claudeDir, projectEncodedId)
  return parseHooks(settings.hooks)
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
  const claudeDir = getClaudeDir()
  const debugLatest = path.join(claudeDir, 'debug', 'latest')
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

export async function readMcps(projectEncodedId?: string): Promise<McpServerEntry[]> {
  const claudeDir = getClaudeDir()
  const seen = new Set<string>()
  const entries: McpServerEntry[] = []

  const statuses = await readMcpStatuses()

  // 1. Read from ~/.claude.json (primary source for global MCPs)
  const claudeJsonPath = path.join(path.dirname(claudeDir), '.claude.json')
  const claudeJson = await readJsonFile<ClaudeJson>(claudeJsonPath)
  for (const [name, cfg] of Object.entries(claudeJson?.mcpServers ?? {})) {
    if (seen.has(name)) continue
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
      level: 'global',
      status: s?.status ?? 'unknown',
      error: s?.error,
      capabilities: s?.capabilities,
      lastSeen: s?.lastSeen,
    })
  }

  // 2. Also read from ~/.claude/settings.json (some setups use this)
  const settings = await readSettings(claudeDir, projectEncodedId)
  for (const [name, cfg] of Object.entries(settings.mcpServers ?? {})) {
    if (seen.has(name)) continue
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
      level: projectEncodedId ? 'project' : 'global',
      status: s?.status ?? 'unknown',
      error: s?.error,
      capabilities: s?.capabilities,
      lastSeen: s?.lastSeen,
    })
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

export async function readMemoryFiles(projectEncodedId?: string): Promise<MemoryFile[]> {
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

  // 2. Project CLAUDE.md
  if (projectEncodedId) {
    const projectClaudeMd = path.join(claudeDir, 'projects', projectEncodedId, 'CLAUDE.md')
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

    // 3. Auto-memory files
    const memoryDir = path.join(claudeDir, 'projects', projectEncodedId, 'memory')
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
// Exported for use by lint rules that need the raw settings object

export async function readRawSettings(projectEncodedId?: string): Promise<RawSettings> {
  return readSettings(getClaudeDir(), projectEncodedId)
}
