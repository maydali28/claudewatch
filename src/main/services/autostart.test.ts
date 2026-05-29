import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Hoisted mocks — vi.mock is hoisted above imports, so the factory references
// must be evaluated inside the factory, not at module scope.
const mockSetLoginItemSettings = vi.fn()
const mockGetPathExe = vi.fn(() => '/Applications/ClaudeWatch.app/Contents/MacOS/ClaudeWatch')
let mockIsPackaged = true

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackaged
    },
    setLoginItemSettings: (...args: unknown[]) => mockSetLoginItemSettings(...args),
    getPath: (name: string) => {
      if (name === 'exe') return mockGetPathExe()
      throw new Error(`Unmocked app.getPath(${name})`)
    },
  },
}))

vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockUnlink = vi.fn()

vi.mock('fs', () => ({
  promises: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}))

vi.mock('os', () => ({
  default: {
    homedir: () => '/home/testuser',
  },
  homedir: () => '/home/testuser',
}))

describe('setAutostart — dev-mode guard', () => {
  beforeEach(() => {
    mockSetLoginItemSettings.mockReset()
    mockIsPackaged = true
    vi.resetModules()
  })

  it('skips OS registration in unpacked dev builds', async () => {
    mockIsPackaged = false
    const { setAutostart } = await import('./autostart')

    await setAutostart(true)

    expect(mockSetLoginItemSettings).not.toHaveBeenCalled()
  })
})

describe('setAutostart — macOS', () => {
  beforeEach(() => {
    mockSetLoginItemSettings.mockReset()
    mockIsPackaged = true
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    vi.resetModules()
  })

  it('calls setLoginItemSettings with openAtLogin: true when enabled', async () => {
    const { setAutostart } = await import('./autostart')

    await setAutostart(true)

    expect(mockSetLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('calls setLoginItemSettings with openAtLogin: false when disabled', async () => {
    const { setAutostart } = await import('./autostart')

    await setAutostart(false)

    expect(mockSetLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })
})

describe('setAutostart — Windows', () => {
  const originalExecPath = process.execPath

  beforeEach(() => {
    mockSetLoginItemSettings.mockReset()
    mockIsPackaged = true
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    Object.defineProperty(process, 'execPath', {
      value: 'C:\\Users\\u\\AppData\\Local\\claudewatch\\app-1.0.0\\claudewatch.exe',
      configurable: true,
    })
    vi.resetModules()
  })

  afterAll(() => {
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true })
  })

  it('points autostart at the Squirrel stub launcher (one directory up)', async () => {
    const { setAutostart } = await import('./autostart')

    await setAutostart(true)

    expect(mockSetLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: 'C:\\Users\\u\\AppData\\Local\\claudewatch\\claudewatch.exe',
      args: [],
    })
  })

  it('passes openAtLogin: false when disabled', async () => {
    const { setAutostart } = await import('./autostart')

    await setAutostart(false)

    expect(mockSetLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openAtLogin: false })
    )
  })
})

describe('setAutostart — Linux', () => {
  beforeEach(() => {
    mockWriteFile.mockReset().mockResolvedValue(undefined)
    mockMkdir.mockReset().mockResolvedValue(undefined)
    mockUnlink.mockReset().mockResolvedValue(undefined)
    mockSetLoginItemSettings.mockReset()
    mockGetPathExe.mockReturnValue('/opt/ClaudeWatch/claudewatch')
    mockIsPackaged = true
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    vi.resetModules()
  })

  it('writes a .desktop file to ~/.config/autostart when enabled', async () => {
    const { setAutostart } = await import('./autostart')

    await setAutostart(true)

    expect(mockMkdir).toHaveBeenCalledWith('/home/testuser/.config/autostart', {
      recursive: true,
    })
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/home/testuser/.config/autostart/claudewatch.desktop',
      expect.stringContaining('Exec=/opt/ClaudeWatch/claudewatch --hidden'),
      'utf8'
    )

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string
    expect(writtenContent).toContain('[Desktop Entry]')
    expect(writtenContent).toContain('Type=Application')
    expect(writtenContent).toContain('Name=ClaudeWatch')
    expect(writtenContent).toContain('X-GNOME-Autostart-enabled=true')
  })

  it('deletes the .desktop file when disabled', async () => {
    const { setAutostart } = await import('./autostart')

    await setAutostart(false)

    expect(mockUnlink).toHaveBeenCalledWith('/home/testuser/.config/autostart/claudewatch.desktop')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('does not throw when disabling and the file does not exist', async () => {
    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { setAutostart } = await import('./autostart')

    await expect(setAutostart(false)).resolves.toBeUndefined()
  })

  it('never calls setLoginItemSettings on Linux', async () => {
    const { setAutostart } = await import('./autostart')

    await setAutostart(true)
    await setAutostart(false)

    expect(mockSetLoginItemSettings).not.toHaveBeenCalled()
  })
})
