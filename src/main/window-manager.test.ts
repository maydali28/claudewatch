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

  constructor(_opts?: unknown) {}

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
  loadURL(): Promise<void> {
    return Promise.resolve()
  }
  loadFile(): Promise<void> {
    return Promise.resolve()
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 380, height: 560 }
  }
  setPosition = vi.fn()
}

const appListeners = new Map<string, Listener[]>()
const fakeApp = {
  isPackaged: true,
  getPath: () => '/tmp',
  once(event: string, cb: Listener) {
    const arr = appListeners.get(event) ?? []
    arr.push(cb)
    appListeners.set(event, arr)
  },
  on(event: string, cb: Listener) {
    this.once(event, cb)
  },
  removeListener(event: string, cb: Listener) {
    const arr = appListeners.get(event) ?? []
    appListeners.set(
      event,
      arr.filter((l) => l !== cb)
    )
  },
  emit(event: string) {
    for (const cb of appListeners.get(event) ?? []) cb()
  },
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
    appListeners.clear()
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
    appListeners.clear()
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
    const win = createTrayPopoverWindow() as unknown as FakeWindow

    fakeApp.emit('before-quit')
    const closeEvent = { preventDefault: vi.fn() }
    win.emit('close', closeEvent)

    expect(closeEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('clears the module-level reference once the window is destroyed', async () => {
    const mod = await import('./window-manager')
    const win = mod.createTrayPopoverWindow() as unknown as FakeWindow

    win.emit('closed')

    expect(mod.getTrayPopoverWindow()).toBeNull()
  })
})

// ─── broadcastToRenderers ─────────────────────────────────────────────────────

describe('broadcastToRenderers', () => {
  beforeEach(() => {
    vi.resetModules()
    appListeners.clear()
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
