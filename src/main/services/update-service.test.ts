import { describe, it, expect, vi } from 'vitest'

// update-service imports electron and electron-log at module load; stub both so
// the module can be imported in a plain node environment.
vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.0' },
  net: { request: () => ({ on: () => {}, setHeader: () => {}, end: () => {} }) },
}))
vi.mock('electron-updater', () => ({
  autoUpdater: { on: () => {}, setFeedURL: () => {} },
}))
vi.mock('electron-log', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('@main/window-manager', () => ({ broadcastToRenderers: () => {} }))

const { parseGithubRepo } = await import('./update-service')

describe('parseGithubRepo', () => {
  // Regression guard for the 1.2.0 updater outage: the feed was pointed at the
  // Hazel server, which serves no latest-*.yml, so every macOS and Windows
  // update check 404'd. owner/repo are now derived from the GitHub releases URL
  // so the feed cannot drift from where release.yml publishes.
  it('extracts owner and repo from the releases download base', () => {
    expect(parseGithubRepo('https://github.com/maydali28/claudewatch/releases/download')).toEqual({
      owner: 'maydali28',
      repo: 'claudewatch',
    })
  })

  it('accepts a bare repository URL', () => {
    expect(parseGithubRepo('https://github.com/maydali28/claudewatch')).toEqual({
      owner: 'maydali28',
      repo: 'claudewatch',
    })
  })

  it('tolerates www, http and a trailing .git', () => {
    expect(parseGithubRepo('http://www.github.com/acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    })
  })

  it('ignores surrounding whitespace', () => {
    expect(parseGithubRepo('  https://github.com/acme/widget  ')).toEqual({
      owner: 'acme',
      repo: 'widget',
    })
  })

  it('returns null for the Hazel server, which is what broke 1.2.0', () => {
    expect(parseGithubRepo('https://claudewatch-releases.vercel.app')).toBeNull()
  })

  it('returns null for an empty or incomplete value', () => {
    expect(parseGithubRepo('')).toBeNull()
    expect(parseGithubRepo('https://github.com/maydali28')).toBeNull()
    expect(parseGithubRepo('not a url')).toBeNull()
  })
})
