import { describe, expect, it } from 'vitest'
import {
  countMcpsByFilter,
  groupMcps,
  mcpCliCommands,
  mcpFilterOf,
  mcpToolRows,
} from './mcp-labels'
import type { McpServerEntry, ToolSummary } from '@shared/types'

const mcp = (name: string, extra: Partial<McpServerEntry> = {}): McpServerEntry => ({
  id: extra.projectId ? `${extra.projectId}:${name}` : name,
  name,
  args: [],
  env: {},
  ...extra,
})

describe('groupMcps', () => {
  it('orders Global, projects, plugins, claude.ai, then Built-in', () => {
    const groups = groupMcps([
      mcp('claude-in-chrome', { level: 'builtin' }),
      mcp('claude.ai Sentry', { level: 'connector' }),
      mcp('plugin:notes:store', { level: 'plugin', pluginName: 'notes' }),
      mcp('github', { level: 'project', projectId: 'z', projectName: 'zeta' }),
      mcp('scratch', { level: 'local', projectId: 'a', projectName: 'Alpha' }),
      mcp('github', { level: 'project', projectId: 'a', projectName: 'Alpha' }),
      mcp('time', { level: 'global' }),
    ])
    expect(groups.map((g) => [g.label, g.items.map((m) => m.name)])).toEqual([
      ['Global', ['time']],
      ['Alpha', ['scratch', 'github']],
      ['zeta', ['github']],
      ['notes', ['plugin:notes:store']],
      ['claude.ai', ['claude.ai Sentry']],
      ['Built-in', ['claude-in-chrome']],
    ])
  })

  it('marks a plugin group disabled only when all its servers are', () => {
    const groups = groupMcps([
      mcp('plugin:a:x', { level: 'plugin', pluginName: 'a', disabled: true }),
      mcp('plugin:b:x', { level: 'plugin', pluginName: 'b' }),
      mcp('off', { level: 'project', projectId: 'p', projectName: 'p', disabled: true }),
    ])
    expect(Object.fromEntries(groups.map((g) => [g.label, g.disabled]))).toEqual({
      p: false,
      a: true,
      b: false,
    })
  })
})

describe('mcp filters', () => {
  it('counts local servers as Project and a missing level as User', () => {
    expect(mcpFilterOf(mcp('x', { level: 'local' }))).toBe('project')
    expect(mcpFilterOf(mcp('x'))).toBe('user')
    expect(
      countMcpsByFilter([mcp('a', { level: 'connector' }), mcp('b', { level: 'global' })])
    ).toEqual({ all: 2, user: 1, project: 0, plugin: 0, connector: 1, builtin: 0 })
  })
})

const usage = (tool: string, calls: number, errors = 0): ToolSummary => ({
  tool,
  calls,
  subagentCalls: 0,
  errors,
  resultChars: 0,
  costUsd: calls / 100,
})

describe('mcpToolRows', () => {
  it('merges offered tools with usage, keeping called tools no longer offered', () => {
    const rows = mcpToolRows(mcp('claude.ai Sentry', { tools: ['search', 'get_issue'] }), [
      usage('mcp__claude_ai_Sentry__search', 5, 1),
      usage('mcp__claude_ai_Sentry__old_tool', 2),
      usage('mcp__github__get_me', 9),
      usage('Read', 40),
    ])
    expect(rows).toEqual([
      { name: 'search', available: true, calls: 5, errors: 1, costUsd: 0.05 },
      { name: 'old_tool', available: false, calls: 2, errors: 0, costUsd: 0.02 },
      { name: 'get_issue', available: true, calls: 0, errors: 0, costUsd: 0 },
    ])
  })
})

describe('mcpCliCommands', () => {
  it('maps levels to claude mcp scopes for files the CLI manages', () => {
    const global = mcp('time', { level: 'global', sourcePath: '/h/.claude.json' })
    expect(mcpCliCommands(global).map((c) => c.command)).toEqual([
      'claude mcp get time',
      'claude mcp remove time -s user',
    ])
    const project = mcp('github', { level: 'project', sourcePath: '/p/.mcp.json' })
    expect(mcpCliCommands(project)[1].command).toBe('claude mcp remove github -s project')
  })

  it('offers none for settings files, plugins, connectors and built-ins', () => {
    expect(
      mcpCliCommands(mcp('a', { level: 'global', sourcePath: '/h/.claude/settings.json' }))
    ).toEqual([])
    expect(mcpCliCommands(mcp('claude.ai Gmail', { level: 'connector' }))).toEqual([])
    expect(mcpCliCommands(mcp('claude-in-chrome', { level: 'builtin' }))).toEqual([])
  })
})
