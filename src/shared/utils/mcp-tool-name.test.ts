import { describe, expect, it } from 'vitest'
import { mcpToolServerName, parseMcpToolName } from './mcp-tool-name'

describe('parseMcpToolName', () => {
  it('splits server and method', () => {
    expect(parseMcpToolName('mcp__github__get_me')).toEqual({ server: 'github', method: 'get_me' })
    expect(parseMcpToolName('mcp__claude_ai_Gmail__search__threads')).toEqual({
      server: 'claude_ai_Gmail',
      method: 'search__threads',
    })
  })

  it('rejects anything else', () => {
    expect(parseMcpToolName('Read')).toBeUndefined()
    expect(parseMcpToolName('mcp__github')).toBeUndefined()
    expect(parseMcpToolName('mcp____x')).toBeUndefined()
    expect(parseMcpToolName('mcp__github__')).toBeUndefined()
  })
})

describe('mcpToolServerName', () => {
  it('replaces characters Claude Code does not keep', () => {
    expect(mcpToolServerName('my.server name')).toBe('my_server_name')
    expect(mcpToolServerName('ok-name_1')).toBe('ok-name_1')
  })
})
