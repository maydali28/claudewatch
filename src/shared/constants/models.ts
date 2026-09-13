import type { ModelFamily } from '@shared/types/pricing'

// ─── Model Family Detection ───────────────────────────────────────────────────
// Maps a raw model string (e.g. "claude-opus-4-5-20251101") → a ModelFamily key
// that indexes into the pricing table.
//
// This is an exact registry, not a substring matcher. A substring matcher
// cannot distinguish a model it knows from a model that merely resembles one:
// `includes('opus-4')` silently classifies a future `claude-opus-4-9` as the
// base Opus 4 release and bills it at that model's rates. An unrecognised ID
// must surface as `unknown` — visible and unpriced — rather than as a
// plausible-looking wrong answer.

const EXACT_MODEL_FAMILIES: Record<string, ModelFamily> = {
  // ── Fable / Mythos ────────────────────────────────────────────────────────
  'claude-fable-5-1': 'fable-5-1',
  'claude-mythos-5-1': 'mythos-5-1',
  'claude-fable-5': 'fable-5',
  'claude-mythos-5': 'mythos-5',

  // ── Opus ──────────────────────────────────────────────────────────────────
  'claude-opus-5': 'opus-5',
  'claude-opus-4-8': 'opus-4-8',
  'claude-opus-4-7': 'opus-4-7',
  'claude-opus-4-6': 'opus-4-6',
  'claude-opus-4-5': 'opus-4-5',
  'claude-opus-4-1': 'opus-4-1',
  'claude-opus-4': 'opus-4',

  // ── Sonnet ────────────────────────────────────────────────────────────────
  'claude-sonnet-5': 'sonnet-5',
  'claude-sonnet-4-6': 'sonnet-4-6',
  'claude-sonnet-4-5': 'sonnet-4-5',
  'claude-sonnet-4': 'sonnet-4',

  // ── Haiku ─────────────────────────────────────────────────────────────────
  'claude-haiku-4-5': 'haiku-4-5',

  // ── Legacy IDs, which order the version before the family ─────────────────
  'claude-3-7-sonnet': 'sonnet-3-7',
  'claude-3-5-sonnet': 'sonnet-3-5',
  'claude-3-5-haiku': 'haiku-3-5',
  'claude-3-opus': 'opus-3',
  'claude-3-haiku': 'haiku-3',
}

/** Trailing dated snapshot, e.g. `-20251101` (Claude API) or `@20251101` (Vertex). */
const DATE_SUFFIX = /[-@]\d{8}$/

export function getModelFamily(model: string | null | undefined): ModelFamily {
  if (!model) return 'unknown'
  const normalized = model.toLowerCase().replace(DATE_SUFFIX, '')
  return EXACT_MODEL_FAMILIES[normalized] ?? 'unknown'
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
