import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

// ─── Fakes ────────────────────────────────────────────────────────────────────

let cursorPoint = { x: 0, y: 0 }

const DISPLAY_A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
const DISPLAY_B = { id: 2, bounds: { x: 1920, y: 0, width: 1440, height: 900 } }
const displays = [DISPLAY_A, DISPLAY_B]

function displayNearest(point: { x: number; y: number }): (typeof displays)[number] {
  return (
    displays.find(
      (d) =>
        point.x >= d.bounds.x &&
        point.x < d.bounds.x + d.bounds.width &&
        point.y >= d.bounds.y &&
        point.y < d.bounds.y + d.bounds.height
    ) ?? DISPLAY_A
  )
}

type Listener = (...args: unknown[]) => void

class FakeWindow {
  webContents = { send: vi.fn(), setWindowOpenHandler: vi.fn() }
  private listeners = new Map<string, Listener[]>()
  private visible = false
  private destroyed = false
  options: Record<string, unknown> | undefined

  constructor(opts?: Record<string, unknown>) {
    this.options = opts
  }

  on(event: string, cb: Listener): this {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb)
    this.listeners.set(event, arr)
    return this
  }
  once(event: string, cb: Listener): this {
    return this.on(event, cb)
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args)
  }

  hide(): void {
    this.visible = false
    this.emit('hide')
  }
  show(): void {
    this.visible = true
  }
  isVisible(): boolean {
    return this.visible
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  setVisibleOnAllWorkspaces(): void {}
  loadURL = vi.fn((_url: string): Promise<void> => Promise.resolve())
  loadFile = vi.fn((_file: string, _options?: { query: Record<string, string> }): Promise<void> =>
    Promise.resolve()
  )
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 380, height: 560 }
  }
  focus = vi.fn()
  setPosition = vi.fn()
  setContentSize = vi.fn()
  center = vi.fn()
}

// `app` here is only ever read for `app.isPackaged` (see IS_DEV) — window-manager.ts
// no longer imports Electron's `autoUpdater` or registers any listener on `app`;
// that responsibility moved to `./lib/update-quit`, which is electron-free and
// carries its own regression guard for the 1.2.6-1.2.9 "listener on the wrong
// emitter" bug (see update-quit.test.ts).
const fakeApp = {
  isPackaged: true,
  getPath: () => '/tmp',
}

vi.mock('electron', () => ({
  app: fakeApp,
  BrowserWindow: FakeWindow,
  shell: { openExternal: vi.fn() },
  screen: {
    getCursorScreenPoint: () => cursorPoint,
    getDisplayNearestPoint: (point: { x: number; y: number }) => displayNearest(point),
  },
}))

vi.mock('./store/preferences', () => ({
  Preferences: { get: () => ({}), set: vi.fn() },
}))

// ─── positionPopoverUnderTray ─────────────────────────────────────────────────

describe('positionPopoverUnderTray', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })

  it('centers the popover under the tray icon on the clicked display', async () => {
    const { positionPopoverUnderTray } = await import('./window-manager')
    const win = new FakeWindow()
    const trayBounds = { x: 2500, y: 0, width: 24, height: 24 } // display B
    cursorPoint = { x: 2510, y: 10 }

    positionPopoverUnderTray(win as unknown as BrowserWindow, trayBounds)

    expect(win.setPosition).toHaveBeenCalledWith(2500 + 12 - 190, 28, false)
  })

  it('positions on the cursor display when tray bounds report another display', async () => {
    // Multi-display macOS: the status item exists in every menu bar and the
    // reported bounds may belong to a display the user did not click.
    const { positionPopoverUnderTray } = await import('./window-manager')
    const win = new FakeWindow()
    const trayBounds = { x: 1000, y: 0, width: 24, height: 24 } // display A
    cursorPoint = { x: 2510, y: 10 } // user actually clicked on display B

    positionPopoverUnderTray(win as unknown as BrowserWindow, trayBounds)

    const [x, y] = win.setPosition.mock.calls[0] as [number, number, boolean]
    expect(x).toBeGreaterThanOrEqual(DISPLAY_B.bounds.x)
    expect(x + 380).toBeLessThanOrEqual(DISPLAY_B.bounds.x + DISPLAY_B.bounds.width)
    expect(y).toBe(DISPLAY_B.bounds.y + 4)
  })

  it('falls back to the cursor position when tray bounds are empty (Linux)', async () => {
    const { positionPopoverUnderTray } = await import('./window-manager')
    const win = new FakeWindow()
    cursorPoint = { x: 960, y: 10 }

    positionPopoverUnderTray(win as unknown as BrowserWindow, {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })

    expect(win.setPosition).toHaveBeenCalledWith(960 - 190, DISPLAY_A.bounds.y + 4, false)
  })
})

// ─── createTrayPopoverWindow close behaviour ──────────────────────────────────

describe('createTrayPopoverWindow', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })

  it('hides instead of closing (Cmd+W via the default app menu must not destroy it)', async () => {
    const { createTrayPopoverWindow } = await import('./window-manager')
    const win = createTrayPopoverWindow() as unknown as FakeWindow
    win.show()

    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(win.isVisible()).toBe(false)
  })

  it('allows the close during app quit', async () => {
    const { createTrayPopoverWindow } = await import('./window-manager')
    const q = await import('./lib/update-quit')
    const win = createTrayPopoverWindow() as unknown as FakeWindow

    q.markAppQuitting()
    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    expect(closeEvent.preventDefault).not.toHaveBeenCalled()
    q.disarmUpdateQuit()
  })

  it('allows the close while an update quit is armed', async () => {
    // Unlike the plain app-quit test above, this exercises the real update
    // path (armUpdateQuit, not a bare markAppQuitting) — the popover must
    // let the close through as soon as the quit is armed, without waiting
    // for the handoff timer to fire.
    vi.useFakeTimers()
    const wm = await import('./window-manager')
    const q = await import('./lib/update-quit')
    const win = wm.createTrayPopoverWindow() as unknown as FakeWindow

    q.armUpdateQuit({ quit: vi.fn(), exit: vi.fn(), log: { info: vi.fn(), warn: vi.fn() } })
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    q.disarmUpdateQuit()
    vi.useRealTimers()
  })

  it('hides instead of closing again once a cancelled install disarmed the quit', async () => {
    const wm = await import('./window-manager')
    const q = await import('./lib/update-quit')
    const win = wm.createTrayPopoverWindow() as unknown as FakeWindow

    q.markAppQuitting() // first attempt
    q.disarmUpdateQuit() // user cancelled the password prompt → updater error → disarm
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(win.isVisible()).toBe(false)
  })

  it('allows the close on a SECOND update quit after the first was cancelled', async () => {
    const wm = await import('./window-manager')
    const q = await import('./lib/update-quit')
    const win = wm.createTrayPopoverWindow() as unknown as FakeWindow

    q.markAppQuitting()
    q.disarmUpdateQuit() // attempt 1, cancelled
    q.markAppQuitting() // attempt 2
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    q.disarmUpdateQuit()
  })

  it('clears the module-level reference once the window is destroyed', async () => {
    const mod = await import('./window-manager')
    const win = mod.createTrayPopoverWindow() as unknown as FakeWindow

    win.emit('closed')

    expect(mod.getTrayPopoverWindow()).toBeNull()
  })
})

// ─── createOrShowUpdateWindow sizing ───────────────────────────────────────────

describe('createOrShowUpdateWindow — window options', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('creates a fixed-width, content-clamped, non-resizable window', async () => {
    const mod = await import('./window-manager')
    const win = mod.createOrShowUpdateWindow(null) as unknown as FakeWindow

    expect(win.options).toMatchObject({
      resizable: false,
      minHeight: 300,
      maxHeight: 760,
      width: 520,
    })
  })
})

// ─── createOrShowUpdateWindow — carrying an install error ─────────────────────
//
// A cancelled or failed install reopens this window with a structured
// `UpdateServiceError`. The new-window path hands the renderer its state as
// query params (read synchronously on mount, before any IPC listener exists),
// and the reuse path pushes the same payload over `push:show-update`. If
// either drops `updateError`, the surface that was showing "Installing…"
// never learns the install failed.

describe('createOrShowUpdateWindow — update error', () => {
  const updateError = {
    phase: 'install' as const,
    message: 'The update could not be installed: user cancelled',
    hint: 'macOS asks for a password because …',
  }
  const info = { version: '9.9.9' }

  beforeEach(() => {
    vi.resetModules()
  })

  function queryOf(win: FakeWindow): Record<string, string> {
    // Production loads a file with a `query` option; the dev server gets the
    // same pairs as a query string. Read whichever this run took.
    if (win.loadFile.mock.calls.length > 0) {
      const [, options] = win.loadFile.mock.calls[0]
      return options?.query ?? {}
    }
    const [url] = win.loadURL.mock.calls[0]
    return Object.fromEntries(new URL(url).searchParams)
  }

  it('puts the update error in the new window’s query', async () => {
    const mod = await import('./window-manager')
    const win = mod.createOrShowUpdateWindow(info, undefined, updateError) as unknown as FakeWindow

    const query = queryOf(win)
    expect(query['updateError']).toBeDefined()
    expect(JSON.parse(query['updateError'])).toEqual(updateError)
    expect(JSON.parse(query['updateInfo'])).toEqual(info)
  })

  it('puts the update error in the push:show-update payload when the window is reused', async () => {
    const mod = await import('./window-manager')
    const win = mod.createOrShowUpdateWindow(null) as unknown as FakeWindow

    mod.createOrShowUpdateWindow(info, undefined, updateError)

    expect(win.webContents.send).toHaveBeenCalledWith('push:show-update', {
      updateInfo: info,
      errorMessage: undefined,
      updateError,
    })
  })
})

// ─── broadcastToRenderers ─────────────────────────────────────────────────────

describe('broadcastToRenderers', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reaches the update window, so its download progress bar actually moves', async () => {
    const mod = await import('./window-manager')
    const updateWin = mod.createOrShowUpdateWindow(null) as unknown as FakeWindow

    mod.broadcastToRenderers('push:update-download-progress', { percent: 42 })

    expect(updateWin.webContents.send).toHaveBeenCalledWith('push:update-download-progress', {
      percent: 42,
    })
  })

  it('still reaches the tray popover', async () => {
    const mod = await import('./window-manager')
    const popover = mod.createTrayPopoverWindow() as unknown as FakeWindow

    mod.broadcastToRenderers('push:today-stats', { total: 1 })

    expect(popover.webContents.send).toHaveBeenCalledWith('push:today-stats', { total: 1 })
  })

  it('skips destroyed windows', async () => {
    const mod = await import('./window-manager')
    const updateWin = mod.createOrShowUpdateWindow(null) as unknown as FakeWindow
    updateWin.emit('closed')

    expect(() => mod.broadcastToRenderers('push:today-stats', {})).not.toThrow()
  })
})
