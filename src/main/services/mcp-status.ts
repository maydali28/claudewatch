import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import { getProjectsDirPath } from '@main/lib/claude-paths'
import { mcpToolServerName, parseMcpToolName } from '@shared/utils/mcp-tool-name'

// Claude Code no longer writes `<claudeDir>/debug/latest` unless run with
// --debug, but every session transcript records what its MCP servers did at
// startup, in a `deferred_tools_delta` attachment:
//
//   addedNames          tool names now available, `mcp__<server>__<tool>` among them
//   failedMcpServers    [{ name, errorCode, error }]
//   needsAuthMcpServers [name]
//   pendingMcpServers   [name]
//
// and the instructions a server sends Claude in an `mcp_instructions_delta`
// (`addedNames[i]` goes with `addedBlocks[i]`, a block headed `## <name>`).
//
// Failed, needs-auth and pending servers are listed by their configured name
// (`claude.ai Gmail`), tools by the tool-name form (`claude_ai_Gmail`), so
// statuses are keyed by `mcpToolServerName`.

export interface TranscriptMcpStatus {
  status: 'connected' | 'failed' | 'needs-auth'
  error?: string
  /** Tools the server offered, for connected servers. */
  toolCount?: number
  /** Their names without the `mcp__<server>__` prefix, sorted. */
  tools?: string[]
  /** Timestamp of the record the status comes from. */
  lastSeen: string
}

/** How many of the most recently written transcripts are read. */
const RECENT_TRANSCRIPTS = 20

interface DeferredToolsDelta {
  type: 'deferred_tools_delta'
  addedNames?: unknown
  failedMcpServers?: unknown
  needsAuthMcpServers?: unknown
}

interface McpInstructionsDelta {
  type: 'mcp_instructions_delta'
  addedNames?: unknown
  addedBlocks?: unknown
}

type Delta = DeferredToolsDelta | McpInstructionsDelta

export interface TranscriptMcpInfo {
  /** Latest status per server, keyed by tool-name form. */
  statuses: Map<string, TranscriptMcpStatus>
  /** Latest instructions per server, keyed by tool-name form. */
  instructions: Map<string, string>
}

/** The newest top-level session transcripts across every project, newest first. */
async function recentTranscripts(limit: number): Promise<string[]> {
  const root = getProjectsDirPath()
  let projectDirs: string[]
  try {
    projectDirs = await fs.promises.readdir(root)
  } catch {
    return []
  }
  const files = (
    await Promise.all(
      projectDirs.map(async (dir) => {
        const full = path.join(root, dir)
        try {
          const names = await fs.promises.readdir(full)
          return Promise.all(
            names
              .filter((n) => n.endsWith('.jsonl'))
              .map(async (n) => {
                const file = path.join(full, n)
                return { file, mtime: (await fs.promises.stat(file)).mtimeMs }
              })
          )
        } catch {
          return []
        }
      })
    )
  ).flat()
  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((f) => f.file)
}

interface TimedDelta {
  file: string
  at: string
  delta: Delta
}

/** Every MCP-related attachment in a transcript, with its timestamp. */
async function readDeltas(file: string): Promise<TimedDelta[]> {
  const out: TimedDelta[] = []
  const lines = readline.createInterface({
    input: fs.createReadStream(file, 'utf-8'),
    crlfDelay: Infinity,
  })
  try {
    for await (const line of lines) {
      if (!line.includes('"deferred_tools_delta"') && !line.includes('"mcp_instructions_delta"')) {
        continue
      }
      try {
        const record = JSON.parse(line) as { timestamp?: unknown; attachment?: unknown }
        const attachment = record.attachment as { type?: unknown } | undefined
        const type = attachment?.type
        if (type !== 'deferred_tools_delta' && type !== 'mcp_instructions_delta') continue
        if (typeof record.timestamp !== 'string') continue
        out.push({ file, at: record.timestamp, delta: attachment as Delta })
      } catch {
        /* a partly written last line */
      }
    }
  } catch {
    /* unreadable file: what was read so far */
  }
  return out
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** A `## <name>` instructions block without its heading line. */
function instructionsBody(block: string): string {
  return block.replace(/^## [^\n]*\n?/, '').trim()
}

/**
 * The latest known status, tools and instructions of each MCP server, keyed
 * by its tool-name form, from the most recent session transcripts. A later
 * record wins; tools announced in several records of one session add up.
 */
export async function readTranscriptMcpInfo(
  limit = RECENT_TRANSCRIPTS
): Promise<TranscriptMcpInfo> {
  const statuses = new Map<string, TranscriptMcpStatus & { file: string }>()
  const instructions = new Map<string, { at: string; text: string }>()
  const set = (key: string, file: string, status: TranscriptMcpStatus): void => {
    const current = statuses.get(key)
    if (current && current.lastSeen > status.lastSeen) return
    // A later record of the same session that adds tools extends the list.
    if (current?.file === file && current.status === 'connected' && status.status === 'connected') {
      const tools = [...new Set([...(current.tools ?? []), ...(status.tools ?? [])])].sort()
      statuses.set(key, { ...status, tools, toolCount: tools.length, file })
      return
    }
    statuses.set(key, { ...status, file })
  }

  const deltas = (await Promise.all((await recentTranscripts(limit)).map(readDeltas))).flat()
  deltas.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  for (const { file, at, delta } of deltas) {
    if (delta.type === 'mcp_instructions_delta') {
      const names = strings(delta.addedNames)
      const blocks = strings(delta.addedBlocks)
      names.forEach((name, i) => {
        const text = blocks[i] ? instructionsBody(blocks[i]) : ''
        if (text) instructions.set(mcpToolServerName(name), { at, text })
      })
      continue
    }
    const tools = new Map<string, string[]>()
    for (const name of strings(delta.addedNames)) {
      const parsed = parseMcpToolName(name)
      if (!parsed) continue
      const list = tools.get(parsed.server) ?? []
      list.push(parsed.method)
      tools.set(parsed.server, list)
    }
    for (const [server, list] of tools) {
      const sorted = [...new Set(list)].sort()
      set(server, file, {
        status: 'connected',
        toolCount: sorted.length,
        tools: sorted,
        lastSeen: at,
      })
    }
    for (const name of strings(delta.needsAuthMcpServers)) {
      set(mcpToolServerName(name), file, { status: 'needs-auth', lastSeen: at })
    }
    if (Array.isArray(delta.failedMcpServers)) {
      for (const f of delta.failedMcpServers as { name?: unknown; error?: unknown }[]) {
        if (typeof f?.name !== 'string') continue
        set(mcpToolServerName(f.name), file, {
          status: 'failed',
          ...(typeof f.error === 'string' ? { error: f.error } : {}),
          lastSeen: at,
        })
      }
    }
  }

  return {
    statuses: new Map([...statuses].map(([key, { file: _file, ...status }]) => [key, status])),
    instructions: new Map([...instructions].map(([key, v]) => [key, v.text])),
  }
}

/** The latest known status of each MCP server. See {@link readTranscriptMcpInfo}. */
export async function readTranscriptMcpStatuses(
  limit = RECENT_TRANSCRIPTS
): Promise<Map<string, TranscriptMcpStatus>> {
  return (await readTranscriptMcpInfo(limit)).statuses
}
