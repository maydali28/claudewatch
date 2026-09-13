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

const { parseGithubRepo, htmlReleaseNotesToMarkdown } = await import('./update-service')

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

describe('htmlReleaseNotesToMarkdown', () => {
  it('converts the exact notes 1.2.1 displayed as raw tags', () => {
    // Verbatim from electron-updater's GitHub provider, which reads the
    // releases Atom feed. The update window showed these tags literally.
    const feed =
      '<h3>Bug Fixes</h3> <ul> ' +
      '<li><strong>deps:</strong> clear the 12 tar advisories, verified against a real package build</li> ' +
      '<li><strong>update:</strong> point the updater at github releases, not the hazel server</li> ' +
      '</ul>'

    expect(htmlReleaseNotesToMarkdown(feed)).toBe(
      [
        '### Bug Fixes',
        '',
        '- **deps:** clear the 12 tar advisories, verified against a real package build',
        '- **update:** point the updater at github releases, not the hazel server',
      ].join('\n')
    )
  })

  it('leaves plain text alone, which is what Hazel returns on Linux', () => {
    const plain = 'Fixed the tray icon.\n\nAlso faster startup.'
    expect(htmlReleaseNotesToMarkdown(plain)).toBe(plain)
  })

  it('keeps markdown that is already markdown untouched', () => {
    const md = '### Bug Fixes\n\n- **deps:** bump everything'
    expect(htmlReleaseNotesToMarkdown(md)).toBe(md)
  })

  it('converts links, emphasis and inline code', () => {
    expect(htmlReleaseNotesToMarkdown('<p>See <a href="https://x.dev">docs</a>.</p>')).toBe(
      'See [docs](https://x.dev).'
    )
    expect(htmlReleaseNotesToMarkdown('<p><em>soon</em> and <code>npm i</code></p>')).toBe(
      '*soon* and `npm i`'
    )
  })

  it('maps heading levels and decodes entities', () => {
    expect(htmlReleaseNotesToMarkdown('<h1>A</h1><h4>B</h4>')).toBe('# A\n\n#### B')
    expect(htmlReleaseNotesToMarkdown('<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>')).toBe(
      'a & b <c> "d"'
    )
  })

  it('drops tags it does not translate rather than printing them', () => {
    expect(htmlReleaseNotesToMarkdown('<div class="x"><span>kept</span></div>')).toBe('kept')
  })

  // CodeQL flagged the original single-pass strip as incomplete
  // multi-character sanitization: the pattern needs a closing ">", so an
  // unterminated tag survived it untouched.
  it('removes an unterminated tag that a single pass would leave behind', () => {
    expect(htmlReleaseNotesToMarkdown('<p>hi</p><script src=x')).toBe('hi')
    expect(htmlReleaseNotesToMarkdown('<p>hi</p><script')).not.toContain('<script')
  })

  it('removes markup that a single pass would splice back together', () => {
    expect(htmlReleaseNotesToMarkdown('<p><scr<x>ipt>alert(1)</p>')).not.toContain('<')
  })

  it('never emits a "<" followed by a tag name, whatever the input', () => {
    const hostile = [
      '<p>a</p><script>alert(1)</script>',
      '<p>a</p><SCRIPT SRC=x',
      '<p>a</p><<script>script>',
      '<p>a</p></div',
    ]
    for (const input of hostile) {
      expect(htmlReleaseNotesToMarkdown(input)).not.toMatch(/<\/?[A-Za-z]/)
    }
  })

  it('keeps a less-than sign that is ordinary prose', () => {
    expect(htmlReleaseNotesToMarkdown('<p>works when a &lt; b</p>')).toBe('works when a < b')
  })
})
