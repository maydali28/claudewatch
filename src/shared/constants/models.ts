import type { ModelFamily } from '@shared/types/pricing'

// ─── Model Family Detection ───────────────────────────────────────────────────
// Maps a raw model string (e.g. "claude-opus-4-5-20250120") → a ModelFamily key
// that indexes into the pricing table.
//
// More-specific version patterns are checked before broader ones to avoid
// false matches (e.g. "opus-4" must not absorb "opus-4-5").

export function getModelFamily(model: string | null | undefined): ModelFamily {
  if (!model) return 'unknown'
  const m = model.toLowerCase()

  // ── Opus ──────────────────────────────────────────────────────────────────
  if (m.includes('opus-4-7')) return 'opus-4-7'
  if (m.includes('opus-4-6')) return 'opus-4-6'
  if (m.includes('opus-4-5')) return 'opus-4-5'
  if (m.includes('opus-4-1')) return 'opus-4-1'
  if (m.includes('opus-4')) return 'opus-4' // base Opus 4 release (no minor version)
  if (m.includes('opus-3')) return 'opus-3'

  // ── Sonnet ────────────────────────────────────────────────────────────────
  if (m.includes('sonnet-4-6')) return 'sonnet-4-6'
  if (m.includes('sonnet-4-5')) return 'sonnet-4-5'
  if (m.includes('sonnet-3-7')) return 'sonnet-3-7'
  if (m.includes('sonnet-4')) return 'sonnet-4' // base Sonnet 4 release (no minor version)

  // ── Haiku ─────────────────────────────────────────────────────────────────
  if (m.includes('haiku-4-5')) return 'haiku-4-5'
  if (m.includes('haiku-3-5')) return 'haiku-3-5'
  if (m.includes('haiku-3')) return 'haiku-3'

  return 'unknown'
}

// ─── Tool Category Mapping ────────────────────────────────────────────────────

import type { ToolCategory } from '@shared/types/session'

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'])
const WRITE_TOOLS = new Set(['Write', 'NotebookEdit'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit'])
const EXEC_TOOLS = new Set(['Bash', 'Monitor', 'EnterWorktree', 'ExitWorktree'])

export function getToolCategory(toolName: string): ToolCategory {
  if (READ_TOOLS.has(toolName)) return 'read'
  if (WRITE_TOOLS.has(toolName)) return 'write'
  if (EDIT_TOOLS.has(toolName)) return 'edit'
  if (EXEC_TOOLS.has(toolName)) return 'exec'
  if (toolName.includes('__')) return 'mcp'
  return 'other'
}

export function parseMcpToolName(toolName: string): { server: string; method: string } | null {
  const parts = toolName.split('__')
  if (parts.length < 3) return null
  return { server: parts.slice(1, -1).join('__'), method: parts[parts.length - 1] }
}
