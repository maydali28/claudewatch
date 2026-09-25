import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleSquirrelEvent } from './squirrel-events'

const EXEC_PATH = 'C:\\Users\\me\\AppData\\Local\\claudewatch\\app-1.5.5\\claudewatch.exe'
const UPDATE_EXE = 'C:\\Users\\me\\AppData\\Local\\claudewatch\\Update.exe'

function setup(argv: string[], platform: NodeJS.Platform = 'win32') {
  const listeners = new Map<string, () => void>()
  const deps = {
    platform,
    argv,
    execPath: EXEC_PATH,
    spawn: vi.fn(() => ({
      on: (event: 'close' | 'error', fn: () => void) => listeners.set(event, fn),
    })),
    quit: vi.fn(),
    exit: vi.fn(),
    disableAutostart: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() },
  }
  const handled = handleSquirrelEvent(deps)
  const emit = (event: string): void => listeners.get(event)?.()
  return { deps, handled, emit }
}

describe('handleSquirrelEvent', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ignores non-Windows platforms', () => {
    const { handled, deps } = setup([EXEC_PATH, '--squirrel-install', '1.5.5'], 'linux')
    expect(handled).toBe(false)
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('boots normally with no hook flag or on first run', () => {
    expect(setup([EXEC_PATH]).handled).toBe(false)
    expect(setup([EXEC_PATH, '--squirrel-firstrun']).handled).toBe(false)
  })

  it.each(['--squirrel-install', '--squirrel-updated'])(
    '%s creates shortcuts, then quits when Update.exe exits',
    (flag) => {
      const { handled, deps, emit } = setup([EXEC_PATH, flag, '1.5.5'])
      expect(handled).toBe(true)
      expect(deps.spawn).toHaveBeenCalledWith(UPDATE_EXE, ['--createShortcut=claudewatch.exe'])
      expect(deps.quit).not.toHaveBeenCalled()
      emit('close')
      expect(deps.quit).toHaveBeenCalledTimes(1)
    }
  )

  it('--squirrel-uninstall clears autostart and removes shortcuts', () => {
    const { handled, deps } = setup([EXEC_PATH, '--squirrel-uninstall', '1.5.5'])
    expect(handled).toBe(true)
    expect(deps.disableAutostart).toHaveBeenCalledTimes(1)
    expect(deps.spawn).toHaveBeenCalledWith(UPDATE_EXE, ['--removeShortcut=claudewatch.exe'])
  })

  it('--squirrel-obsolete quits without running Update.exe', () => {
    const { handled, deps } = setup([EXEC_PATH, '--squirrel-obsolete', '1.5.4'])
    expect(handled).toBe(true)
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(deps.quit).toHaveBeenCalledTimes(1)
  })

  it('quits once even if Update.exe errors and then closes', () => {
    const { deps, emit } = setup([EXEC_PATH, '--squirrel-install', '1.5.5'])
    emit('error')
    emit('close')
    expect(deps.quit).toHaveBeenCalledTimes(1)
  })

  it('hard-exits if Update.exe never returns, before Squirrel kills the hook', () => {
    const { deps } = setup([EXEC_PATH, '--squirrel-install', '1.5.5'])
    vi.advanceTimersByTime(5_000)
    expect(deps.exit).toHaveBeenCalledWith(0)
  })
})
