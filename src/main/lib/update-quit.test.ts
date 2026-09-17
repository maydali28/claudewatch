import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('update quit coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms a cooperative quit then a hard exit', async () => {
    const m = await import('./update-quit')
    const quit = vi.fn()
    const exit = vi.fn()
    m.armUpdateQuit({ quit, exit, log: { info: vi.fn(), warn: vi.fn() } })
    expect(m.isAppQuitting()).toBe(true)
    vi.advanceTimersByTime(2_000)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5_000)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('disarm cancels both timers and clears the flag, so a cancelled install leaves the app running', async () => {
    const m = await import('./update-quit')
    const quit = vi.fn()
    const exit = vi.fn()
    m.armUpdateQuit({ quit, exit, log: { info: vi.fn(), warn: vi.fn() } })
    m.disarmUpdateQuit()
    expect(m.isAppQuitting()).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(quit).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it('arming twice does not double the timers', async () => {
    const m = await import('./update-quit')
    const quit = vi.fn()
    const exit = vi.fn()
    const deps = { quit, exit, log: { info: vi.fn(), warn: vi.fn() } }
    m.armUpdateQuit(deps)
    m.armUpdateQuit(deps)
    vi.advanceTimersByTime(7_000)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('arm, disarm, then arm again schedules exactly one quit and one exit', async () => {
    const m = await import('./update-quit')
    const quit = vi.fn()
    const exit = vi.fn()
    const deps = { quit, exit, log: { info: vi.fn(), warn: vi.fn() } }
    m.armUpdateQuit(deps)
    m.disarmUpdateQuit()
    m.armUpdateQuit(deps)
    vi.advanceTimersByTime(7_000)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('onUpdateQuitDisarmed listeners fire once disarm has cleared state', async () => {
    const m = await import('./update-quit')
    const listener = vi.fn()
    m.onUpdateQuitDisarmed(listener)
    m.armUpdateQuit({ quit: vi.fn(), exit: vi.fn(), log: { info: vi.fn(), warn: vi.fn() } })
    expect(listener).not.toHaveBeenCalled()
    m.disarmUpdateQuit()
    expect(listener).toHaveBeenCalledTimes(1)
    // By the time the listener runs, state is already clear — this is what
    // lets index.ts recreate the dashboard window synchronously inside it.
    expect(m.isAppQuitting()).toBe(false)
  })

  /**
   * Regression guard for the 1.2.6–1.2.9 bug: the update-quit listener was
   * registered on `app`, which never emits `before-quit-for-update` —
   * Electron's built-in `autoUpdater` (Squirrel) is the only emitter of that
   * event. The handler existed but could not fire, so "Install & Restart"
   * silently did nothing. Two separate fake emitters here so a listener
   * registered on the wrong one fails this test rather than shipping quietly
   * broken again.
   */
  it('registerUpdateQuitHandlers puts the update-quit listener on the updater, not on app, and it arms the quit', async () => {
    const m = await import('./update-quit')
    type Listener = () => void
    const appListeners = new Map<string, Listener>()
    const updaterListeners = new Map<string, Listener>()
    const fakeApp = {
      on: (event: string, fn: Listener) => {
        appListeners.set(event, fn)
      },
      quit: vi.fn(),
      exit: vi.fn(),
    }
    const fakeSquirrelUpdater = {
      on: (event: string, fn: Listener) => {
        updaterListeners.set(event, fn)
      },
    }
    const log = { info: vi.fn(), warn: vi.fn() }

    m.registerUpdateQuitHandlers({ app: fakeApp, squirrelUpdater: fakeSquirrelUpdater, log })

    expect(updaterListeners.has('before-quit-for-update')).toBe(true)
    expect(appListeners.has('before-quit-for-update')).toBe(false)
    expect(appListeners.has('before-quit')).toBe(true)

    updaterListeners.get('before-quit-for-update')!()
    expect(m.isAppQuitting()).toBe(true)
    vi.advanceTimersByTime(2_000)
    expect(fakeApp.quit).toHaveBeenCalledTimes(1)
  })
})
