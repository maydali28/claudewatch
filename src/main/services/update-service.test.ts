import { describe, it, expect, vi, beforeEach } from 'vitest'

// update-service imports electron and electron-log at module load; stub both so
// the module can be imported in a plain node environment.
vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.0' },
  net: { request: () => ({ on: () => {}, setHeader: () => {}, end: () => {} }) },
}))
const updaterHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>())
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      updaterHandlers.set(event, handler)
    },
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
  },
}))
vi.mock('electron-log', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {} },
}))
const broadcast = vi.hoisted(() => vi.fn())
const createOrShowUpdateWindow = vi.hoisted(() => vi.fn())
vi.mock('@main/window-manager', () => ({
  broadcastToRenderers: broadcast,
  createOrShowUpdateWindow,
}))
const disarmUpdateQuit = vi.hoisted(() => vi.fn())
vi.mock('@main/lib/update-quit', () => ({ disarmUpdateQuit }))
vi.mock('@main/lib/app-config', () => ({
  AppConfig: {
    githubReleasesUrl: 'https://github.com/maydali28/claudewatch/releases',
    releaseServerUrl: '',
    sentryDsn: '',
  },
}))

// A static import is safe here: vitest hoists the `vi.mock` calls above it, so
// the stubs are registered before the module is evaluated. Top-level `await`
// cannot be used — this project compiles to CommonJS for the Electron main
// process, where TypeScript rejects it.
import { parseGithubRepo, htmlReleaseNotesToMarkdown } from './update-service'

// `checkForUpdate()` branches on `process.platform`: the CI runner is Linux,
// which takes the Hazel-polling path instead of the electron-updater path
// these tests exercise (the Hazel path would hang forever against the bare
// `net.request` stub above, which never fires a response/error event). Force
// a non-Linux platform for the duration of a test, then restore it — other
// tests in this file never depend on the real platform.
async function withNonLinuxPlatform(run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  try {
    await run()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

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

describe('installUpdate lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules()
    updaterHandlers.clear()
    broadcast.mockClear()
    disarmUpdateQuit.mockClear()
    createOrShowUpdateWindow.mockClear()
  })

  it('rejects when nothing has been downloaded', async () => {
    const svc = await import('./update-service')
    svc.initUpdateService()
    await expect(svc.installUpdate()).rejects.toThrow('No update has been downloaded yet')
  })

  it('moves to installing, and a second call while installing is refused', async () => {
    const svc = await import('./update-service')
    svc.initUpdateService()
    updaterHandlers.get('update-downloaded')!({})
    await svc.installUpdate()
    expect(svc.getUpdatePhase()).toBe('installing')
    await expect(svc.installUpdate()).rejects.toThrow('An install is already in progress')
  })

  it('an updater error during install resets to idle, forgets the download, and reports phase=install', async () => {
    const svc = await import('./update-service')
    svc.initUpdateService()
    updaterHandlers.get('update-downloaded')!({})
    await svc.installUpdate()
    updaterHandlers.get('error')!(
      new Error('The operation couldn’t be completed. (SQRLInstallerErrorDomain error -1.)')
    )
    expect(svc.getUpdatePhase()).toBe('idle')
    expect(broadcast).toHaveBeenCalledWith(
      'push:update-service-error',
      expect.objectContaining({ phase: 'install' })
    )
    // Retry must go through download again — install alone is refused.
    await expect(svc.installUpdate()).rejects.toThrow('No update has been downloaded yet')
  })

  it('an updater error during install disarms the update quit, so a cancelled password prompt does not quit the app a few seconds later', async () => {
    const svc = await import('./update-service')
    svc.initUpdateService()
    updaterHandlers.get('update-downloaded')!({})
    await svc.installUpdate()
    updaterHandlers.get('error')!(new Error('user cancelled the password prompt'))
    expect(disarmUpdateQuit).toHaveBeenCalledTimes(1)
  })

  it('an updater error during install reopens the update window with the error, since quitAndInstall may have already closed it', async () => {
    const svc = await import('./update-service')
    svc.initUpdateService()
    updaterHandlers.get('update-downloaded')!({})
    await svc.installUpdate()
    updaterHandlers.get('error')!(new Error('user cancelled the password prompt'))
    expect(createOrShowUpdateWindow).toHaveBeenCalledTimes(1)
    expect(createOrShowUpdateWindow).toHaveBeenCalledWith(
      null,
      undefined,
      expect.objectContaining({ phase: 'install' })
    )
  })

  it('an updater error during a plain check does not reopen the update window — nothing was installing', async () => {
    await withNonLinuxPlatform(async () => {
      const svc = await import('./update-service')
      const { autoUpdater } = await import('electron-updater')
      svc.initUpdateService()
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        updaterHandlers.get('error')!(new Error('net::ERR_INTERNET_DISCONNECTED'))
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      })
      await expect(svc.checkForUpdate()).rejects.toThrow('net::ERR_INTERNET_DISCONNECTED')
      expect(createOrShowUpdateWindow).not.toHaveBeenCalled()
    })
  })

  it('an updater error during a plain check does not disarm the update quit — nothing armed it', async () => {
    await withNonLinuxPlatform(async () => {
      const svc = await import('./update-service')
      const { autoUpdater } = await import('electron-updater')
      svc.initUpdateService()
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        updaterHandlers.get('error')!(new Error('net::ERR_INTERNET_DISCONNECTED'))
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      })
      await expect(svc.checkForUpdate()).rejects.toThrow('net::ERR_INTERNET_DISCONNECTED')
      expect(disarmUpdateQuit).not.toHaveBeenCalled()
    })
  })

  it('an updater error during a real check reports phase=check and leaves the service idle', async () => {
    await withNonLinuxPlatform(async () => {
      const svc = await import('./update-service')
      const { autoUpdater } = await import('electron-updater')
      svc.initUpdateService()
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        // The phase must actually be 'checking' while the check is under
        // way — this is what the old test (which fired the 'error' handler
        // without ever calling checkForUpdate()) failed to exercise.
        expect(svc.getUpdatePhase()).toBe('checking')
        // Simulate electron-updater failing mid-check: it reports the
        // failure through the 'error' event rather than rejecting cleanly.
        updaterHandlers.get('error')!(new Error('net::ERR_INTERNET_DISCONNECTED'))
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      })
      await expect(svc.checkForUpdate()).rejects.toThrow('net::ERR_INTERNET_DISCONNECTED')
      expect(broadcast).toHaveBeenCalledWith(
        'push:update-service-error',
        expect.objectContaining({ phase: 'check' })
      )
      expect(svc.getUpdatePhase()).toBe('idle')
    })
  })

  it('an updater error during a real download reports phase=download and leaves the service idle', async () => {
    const svc = await import('./update-service')
    const { autoUpdater } = await import('electron-updater')
    svc.initUpdateService()
    vi.mocked(autoUpdater.downloadUpdate).mockImplementation(async () => {
      expect(svc.getUpdatePhase()).toBe('downloading')
      updaterHandlers.get('error')!(new Error('net::ERR_CONNECTION_RESET'))
      throw new Error('net::ERR_CONNECTION_RESET')
    })
    await expect(svc.downloadUpdate()).rejects.toThrow('net::ERR_CONNECTION_RESET')
    expect(broadcast).toHaveBeenCalledWith(
      'push:update-service-error',
      expect.objectContaining({ phase: 'download' })
    )
    expect(svc.getUpdatePhase()).toBe('idle')
  })

  it('a successful download moves the phase to downloaded', async () => {
    const svc = await import('./update-service')
    const { autoUpdater } = await import('electron-updater')
    svc.initUpdateService()
    vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([])
    await svc.downloadUpdate()
    expect(svc.getUpdatePhase()).toBe('downloaded')
  })

  it('a check that runs while an install is in flight does not disturb the installing phase', async () => {
    await withNonLinuxPlatform(async () => {
      const svc = await import('./update-service')
      const { autoUpdater } = await import('electron-updater')
      svc.initUpdateService()
      updaterHandlers.get('update-downloaded')!({})
      await svc.installUpdate()
      expect(svc.getUpdatePhase()).toBe('installing')

      // The tray popover triggers a check regardless of what else is going
      // on; it must not steal the phase away from the in-flight install.
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
      await svc.checkForUpdate()
      expect(svc.getUpdatePhase()).toBe('installing')

      // An error arriving after that check must still be attributed to the
      // install it actually belongs to.
      updaterHandlers.get('error')!(new Error('SQRLInstallerErrorDomain error -1'))
      expect(broadcast).toHaveBeenCalledWith(
        'push:update-service-error',
        expect.objectContaining({ phase: 'install' })
      )
    })
  })
})

describe('showUpdateWindowAfterCheck', () => {
  beforeEach(async () => {
    vi.resetModules()
    updaterHandlers.clear()
    broadcast.mockClear()
    disarmUpdateQuit.mockClear()
    createOrShowUpdateWindow.mockClear()
  })

  it('opens the update window with the info on a successful check', async () => {
    await withNonLinuxPlatform(async () => {
      const svc = await import('./update-service')
      const { autoUpdater } = await import('electron-updater')
      svc.initUpdateService()
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
        updateInfo: { version: '9.9.9', releaseNotes: undefined, releaseDate: undefined },
      } as never)

      await svc.showUpdateWindowAfterCheck()

      expect(createOrShowUpdateWindow).toHaveBeenCalledTimes(1)
      expect(createOrShowUpdateWindow).toHaveBeenCalledWith(
        expect.objectContaining({ version: '9.9.9' })
      )
    })
  })

  it('opens the update window with (null, message) when the check throws', async () => {
    await withNonLinuxPlatform(async () => {
      const svc = await import('./update-service')
      const { autoUpdater } = await import('electron-updater')
      svc.initUpdateService()
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(
        new Error('net::ERR_INTERNET_DISCONNECTED')
      )

      await svc.showUpdateWindowAfterCheck()

      expect(createOrShowUpdateWindow).toHaveBeenCalledTimes(1)
      expect(createOrShowUpdateWindow).toHaveBeenCalledWith(null, 'net::ERR_INTERNET_DISCONNECTED')
    })
  })
})
