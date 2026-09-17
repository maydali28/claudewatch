import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const fixtureHome = vi.hoisted(() => ({ path: '' }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  return { ...actual, homedir: () => fixtureHome.path }
})

describe('claude-paths', () => {
  let home: string
  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-paths-'))
    fixtureHome.path = home
    delete process.env.CLAUDE_CONFIG_DIR
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
  })
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('defaults to ~/.claude and ~/.claude.json', async () => {
    const m = await import('./claude-paths')
    expect(m.getClaudeDir()).toBe(path.join(home, '.claude'))
    expect(m.getClaudeJsonPath()).toBe(path.join(home, '.claude.json'))
    expect(m.getClaudeDirSource()).toBe('default')
  })

  it('honours CLAUDE_CONFIG_DIR from the environment, expanding ~', async () => {
    process.env.CLAUDE_CONFIG_DIR = '~/.claude-work'
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    expect(m.getClaudeDir()).toBe(path.join(home, '.claude-work'))
    expect(m.getClaudeJsonPath()).toBe(path.join(home, '.claude-work', '.claude.json'))
    expect(m.getProjectsDirPath()).toBe(path.join(home, '.claude-work', 'projects'))
    expect(m.getClaudeDirSource()).toBe('env')
  })

  it('honours env.CLAUDE_CONFIG_DIR in the default user settings when the process env is unset', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.claude', 'settings.json'),
      JSON.stringify({ env: { CLAUDE_CONFIG_DIR: path.join(home, 'elsewhere') } })
    )
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    expect(m.getClaudeDir()).toBe(path.join(home, 'elsewhere'))
    expect(m.getClaudeDirSource()).toBe('user-settings')
  })

  it('describeClaudeDir shortens the home prefix', async () => {
    const m = await import('./claude-paths')
    expect(m.describeClaudeDir()).toBe('~/.claude')
  })

  // Additional coverage beyond the brief's four cases, added test-first
  // alongside the implementation below.

  it('caches the resolution across calls even if the environment changes afterward', async () => {
    const m = await import('./claude-paths')
    expect(m.getClaudeDir()).toBe(path.join(home, '.claude'))
    process.env.CLAUDE_CONFIG_DIR = '~/.claude-work'
    // No resetClaudeDirCache() call here — resolution must not change.
    expect(m.getClaudeDir()).toBe(path.join(home, '.claude'))
    expect(m.getClaudeDirSource()).toBe('default')
  })

  it('resolves a relative CLAUDE_CONFIG_DIR against the home directory', async () => {
    process.env.CLAUDE_CONFIG_DIR = '.claude-work'
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    expect(m.getClaudeDir()).toBe(path.join(home, '.claude-work'))
    expect(m.getClaudeDirSource()).toBe('env')
  })

  it('ignores a blank CLAUDE_CONFIG_DIR and falls through to the default', async () => {
    process.env.CLAUDE_CONFIG_DIR = '   '
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    expect(m.getClaudeDir()).toBe(path.join(home, '.claude'))
    expect(m.getClaudeDirSource()).toBe('default')
  })

  it('trims surrounding whitespace from a process-env CLAUDE_CONFIG_DIR', async () => {
    process.env.CLAUDE_CONFIG_DIR = `  ${path.join(home, 'padded')}  `
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    expect(m.getClaudeDir()).toBe(path.join(home, 'padded'))
  })

  it('ignores a malformed user settings.json rather than throwing', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ not valid json')
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    expect(m.getClaudeDir()).toBe(path.join(home, '.claude'))
    expect(m.getClaudeDirSource()).toBe('default')
  })

  it('prefers the process env over a user-settings override', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.claude', 'settings.json'),
      JSON.stringify({ env: { CLAUDE_CONFIG_DIR: path.join(home, 'from-settings') } })
    )
    process.env.CLAUDE_CONFIG_DIR = path.join(home, 'from-env')
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    expect(m.getClaudeDir()).toBe(path.join(home, 'from-env'))
    expect(m.getClaudeDirSource()).toBe('env')
  })

  it('derives every sub-path helper from the resolved dir, overridden or not', async () => {
    process.env.CLAUDE_CONFIG_DIR = path.join(home, 'override')
    const m = await import('./claude-paths')
    m.resetClaudeDirCache()
    const dir = path.join(home, 'override')
    expect(m.getUserSettingsPath()).toBe(path.join(dir, 'settings.json'))
    expect(m.getUserSettingsLocalPath()).toBe(path.join(dir, 'settings.local.json'))
    expect(m.getDefaultPlansDirPath()).toBe(path.join(dir, 'plans'))
    expect(m.getUserCommandsDirPath()).toBe(path.join(dir, 'commands'))
    expect(m.getUserSkillsDirPath()).toBe(path.join(dir, 'skills'))
    expect(m.getMcpDebugLatestPath()).toBe(path.join(dir, 'debug', 'latest'))
  })

  it('describeClaudeDir returns the absolute override path unshortened when outside home', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-paths-outside-'))
    try {
      process.env.CLAUDE_CONFIG_DIR = outside
      const m = await import('./claude-paths')
      m.resetClaudeDirCache()
      expect(m.describeClaudeDir()).toBe(outside)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  // Fix round 1, finding 1: the accounting worker runs in its own
  // `worker_threads` realm and has no `resolve()` of its own to call safely
  // (no access to the main thread's already-loaded settings.json read, and no
  // reason to re-do that I/O) — it seeds this module's cache directly from
  // what the main thread already resolved.
  describe('seedClaudeDir', () => {
    it('overwrites the cache so every getter reports the seeded dir and source', async () => {
      const m = await import('./claude-paths')
      const seeded = path.join(home, 'seeded-elsewhere')
      m.seedClaudeDir(seeded, 'user-settings')

      expect(m.getClaudeDir()).toBe(seeded)
      expect(m.getClaudeDirSource()).toBe('user-settings')
      expect(m.getProjectsDirPath()).toBe(path.join(seeded, 'projects'))
      expect(m.getClaudeJsonPath()).toBe(path.join(seeded, '.claude.json'))
    })

    it('overwrites a prior real resolution, not just an empty cache', async () => {
      const m = await import('./claude-paths')
      // Resolve for real first (default case), THEN seed over it.
      expect(m.getClaudeDir()).toBe(path.join(home, '.claude'))

      const seeded = path.join(home, 'seeded-elsewhere')
      m.seedClaudeDir(seeded, 'env')

      expect(m.getClaudeDir()).toBe(seeded)
      expect(m.getClaudeDirSource()).toBe('env')
    })

    it('resetClaudeDirCache() clears a seeded value, not just a resolved one', async () => {
      const m = await import('./claude-paths')
      m.seedClaudeDir(path.join(home, 'seeded-elsewhere'), 'env')
      m.resetClaudeDirCache()

      // Falls through to a real resolution again — back to the default,
      // since the seeded value is gone and CLAUDE_CONFIG_DIR is unset.
      expect(m.getClaudeDir()).toBe(path.join(home, '.claude'))
      expect(m.getClaudeDirSource()).toBe('default')
    })
  })
})
