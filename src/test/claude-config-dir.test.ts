import { describe, expect, it } from 'vitest'
import { shouldClearClaudeConfigDir } from './claude-config-dir'

describe('shouldClearClaudeConfigDir', () => {
  it('clears it for ordinary unit runs', () => {
    expect(shouldClearClaudeConfigDir({ CLAUDE_CONFIG_DIR: '/tmp/other' })).toBe(true)
  })

  // `pnpm verify:accounting` reads real history; a contributor who selects a
  // relocated Claude folder must get that folder verified, not ~/.claude.
  it('keeps it for the real-history verification run', () => {
    expect(
      shouldClearClaudeConfigDir({ CLAUDE_CONFIG_DIR: '/tmp/other', VERIFY_ACCOUNTING: '1' })
    ).toBe(false)
  })

  it('clears it when VERIFY_ACCOUNTING is set to anything but 1', () => {
    expect(shouldClearClaudeConfigDir({ VERIFY_ACCOUNTING: '0' })).toBe(true)
  })
})
