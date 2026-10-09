import type { RawRecord, ToolUsageRow } from '@shared/types/session'
import type { ResponseEntry } from '@main/services/accounting/ledger'
import { toDayKeyOrUndated } from '@shared/utils/date-ranges'
import { parseMcpToolName } from '@shared/utils/mcp-tool-name'
import { getRawBlocks, isSyntheticAssistant } from './parser-helpers'
import { assistantResponseId } from './response-observability'

// Tool calls are read from the assistant's tool_use blocks and joined with
// the tool_result blocks the following user records carry, by tool_use id.
// Claude Code writes each tool_use of a response as its own record, and the
// same id can be replayed, so calls are keyed by id and counted once.

interface ToolCall {
  tool: string
  responseId: string
  timestamp?: string
}

interface ToolResult {
  isError: boolean
  chars: number
}

export interface ToolUsageAccumulator {
  add(raw: RawRecord): void
  /**
   * One row per day and tool. `entries` are this transcript's ledger entries:
   * they give each call's day and the cost of the response that made it.
   */
  rows(entries: readonly ResponseEntry[]): ToolUsageRow[]
}

function resultChars(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let chars = 0
  for (const chunk of content) {
    if (chunk && typeof chunk === 'object' && typeof chunk.text === 'string') {
      chars += chunk.text.length
    }
  }
  return chars
}

export function createToolUsageAccumulator(source: 'parent' | 'subagent'): ToolUsageAccumulator {
  const calls = new Map<string, ToolCall>()
  const results = new Map<string, ToolResult>()

  return {
    add(raw) {
      if (raw.type === 'assistant' && !isSyntheticAssistant(raw)) {
        const responseId = assistantResponseId(raw)
        for (const block of getRawBlocks(raw)) {
          if (block.type !== 'tool_use' || !block.id || !block.name || calls.has(block.id)) continue
          calls.set(block.id, { tool: block.name, responseId, timestamp: raw.timestamp })
        }
      } else if (raw.type === 'user') {
        for (const block of getRawBlocks(raw)) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue
          results.set(block.tool_use_id, {
            isError: block.is_error === true,
            chars: resultChars(block.content),
          })
        }
      }
    },

    rows(entries) {
      const entryById = new Map<string, ResponseEntry>()
      for (const entry of entries) entryById.set(entry.responseId, entry)
      const callsPerResponse = new Map<string, number>()
      for (const call of calls.values()) {
        callsPerResponse.set(call.responseId, (callsPerResponse.get(call.responseId) ?? 0) + 1)
      }

      const rows = new Map<string, ToolUsageRow>()
      for (const [id, call] of calls) {
        const entry = entryById.get(call.responseId)
        const day = entry?.dayLocal ?? toDayKeyOrUndated(call.timestamp)
        const key = `${day}\u0000${call.tool}`
        let row = rows.get(key)
        if (!row) {
          row = { day, tool: call.tool, source, calls: 0, errors: 0, resultChars: 0, costUsd: 0 }
          const mcp = parseMcpToolName(call.tool)
          if (mcp) row.mcpServer = mcp.server
          rows.set(key, row)
        }
        row.calls++
        const result = results.get(id)
        if (result?.isError) row.errors++
        row.resultChars += result?.chars ?? 0
        if (entry?.costUsd != null) {
          row.costUsd += entry.costUsd / (callsPerResponse.get(call.responseId) ?? 1)
        }
      }
      return [...rows.values()]
    },
  }
}

/** Add `rows` into `into`, merging rows with the same day, tool and source. */
export function mergeToolUsage(into: ToolUsageRow[], rows: readonly ToolUsageRow[]): void {
  const index = new Map(into.map((r, i) => [`${r.day}\u0000${r.tool}\u0000${r.source}`, i]))
  for (const row of rows) {
    const key = `${row.day}\u0000${row.tool}\u0000${row.source}`
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, into.length)
      into.push({ ...row })
      continue
    }
    const existing = into[at]
    existing.calls += row.calls
    existing.errors += row.errors
    existing.resultChars += row.resultChars
    existing.costUsd += row.costUsd
  }
}
