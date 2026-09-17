import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'

// ─── Fakes ────────────────────────────────────────────────────────────────────
// vi.mock factories are hoisted but execute lazily (on first import of the
// mocked module), so referencing these classes from inside the factories is
// safe — see autostart.test.ts for the same pattern.

let allWindows: FakeWindow[] = []
let cursorPoint = { x: 0, y: 0 }

const DISPLAY_A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
const DISPLAY_B = { id: 2, bounds: { x: 1920, y: 0, width: 1440, height: 900 } }

function displayNearest(point: { x: number; y: number }): typeof DISPLAY_A {
  return point.x >= DISPLAY_B.bounds.x ? DISPLAY_B : DISPLAY_A
}

class FakeWindow {
  static nextId = 1
  id = FakeWindow.nextId++
  webContents = { send: vi.fn() }
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  private visible = false
  private destroyed = false
  private focusedState = false
  private position = { x: 0, y: 0 }

  on(event: string, cb: (...args: unknown[]) => void): this {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb)
    this.listeners.set(event, arr)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args)
  }

  show(): void {
    this.visible = true
  }
  showInactive(): void {
    this.visible = true
  }
  hide(): void {
    this.visible = false
    this.emit('hide')
  }
  focus(): void {
    this.focusedState = true
    this.emit('focus')
  }
  blur(): void {
    this.focusedState = false
    this.emit('blur')
  }
  isVisible(): boolean {
    return this.visible
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  isFocused(): boolean {
    return this.focusedState
  }
  destroy(): void {
    this.destroyed = true
  }
  setAlwaysOnTop(): void {}
  setSkipTaskbar(): void {}
  setPosition(x: number, y: number): void {
    this.position = { x, y }
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: this.position.x, y: this.position.y, width: 380, height: 560 }
  }

  static getAllWindows(): FakeWindow[] {
    return allWindows
  }
}

class FakeTray {
  static latest: FakeTray | null = null
  bounds = { x: 100, y: 0, width: 24, height: 24 }
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  constructor() {
    FakeTray.latest = this
  }

  on(event: string, cb: (...args: unknown[]) => void): this {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb)
    this.listeners.set(event, arr)
    return this
  }

  click(bounds = this.bounds): void {
    for (const cb of this.listeners.get('click') ?? []) cb({}, bounds)
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return this.bounds
  }
  setToolTip(): void {}
  setImage(): void {}
  setContextMenu(): void {}
  popUpContextMenu(): void {}
  destroy(): void {}
}

vi.mock('electron', () => ({
  Tray: FakeTray,
  BrowserWindow: FakeWindow,
  Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => false, setTemplateImage: () => {} }),
    createFromDataURL: () => ({ isEmpty: () => false }),
  },
  app: {
    getPath: () => '/tmp',
    quit: vi.fn(),
    dock: { show: vi.fn(), hide: vi.fn() },
  },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  screen: {
    getCursorScreenPoint: () => cursorPoint,
    getDisplayNearestPoint: (point: { x: number; y: number }) => displayNearest(point),
  },
}))

const createdPopovers: FakeWindow[] = []
const positionPopoverUnderTray = vi.fn(
  (win: FakeWindow, trayBounds: { x: number; y: number; width: number; height: number }) => {
    // Mirror the real behaviour closely enough for display detection: place
    // the popover at the tray icon's position.
    win.setPosition(trayBounds.x, trayBounds.y + trayBounds.height)
  }
)
vi.mock('./window-manager', () => ({
  createTrayPopoverWindow: vi.fn(() => {
    const win = new FakeWindow()
    createdPopovers.push(win)
    allWindows.push(win)
    return win
  }),
  positionPopoverUnderTray,
  getTrayPopoverWindow: () => createdPopovers[createdPopovers.length - 1] ?? null,
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

const CURSOR_ON_TRAY = { x: 110, y: 10 } // inside FakeTray bounds (100,0 24x24)
const CURSOR_AWAY = { x: 800, y: 500 }

async function setup(): Promise<{ tray: FakeTray; popover: FakeWindow }> {
  const { setupTray } = await import('./tray-manager')
  const mainWindow = new FakeWindow()
  allWindows.push(mainWindow)
  setupTray(() => mainWindow as unknown as BrowserWindow)
  return { tray: FakeTray.latest!, popover: createdPopovers[0]! }
}

describe('tray popover toggle (macOS)', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    allWindows = []
    createdPopovers.length = 0
    FakeTray.latest = null
    cursorPoint = CURSOR_AWAY
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tray click opens the popover', async () => {
    const { tray, popover } = await setup()

    tray.click()

    expect(popover.isVisible()).toBe(true)
  })

  it('closes on tray click even when blur fires first (macOS event order)', async () => {
    const { tray, popover } = await setup()
    tray.click() // open (focus() is called after showInactive)
    expect(popover.isVisible()).toBe(true)

    // Second tray click: mousedown blurs the panel BEFORE the click event.
    // The cursor is over the tray icon at that moment.
    cursorPoint = CURSOR_ON_TRAY
    popover.blur()
    expect(popover.isVisible()).toBe(true) // blur must defer to the click handler

    tray.click()
    expect(popover.isVisible()).toBe(false) // click completes the toggle
  })

  it('hides when focus is lost to a click elsewhere', async () => {
    const { tray, popover } = await setup()
    tray.click()

    cursorPoint = CURSOR_AWAY
    popover.blur()

    expect(popover.isVisible()).toBe(false)
  })

  it('does not instantly re-open when a blur-hide immediately precedes the click', async () => {
    // Multi-display case: tray.getBounds() can report another display's icon,
    // so the cursor-over-tray check misses and blur hides the popover. The
    // click that caused that blur must then not re-open it.
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { tray, popover } = await setup()
    tray.click()

    cursorPoint = CURSOR_AWAY // simulates unreliable tray geometry
    popover.blur()
    expect(popover.isVisible()).toBe(false)

    vi.setSystemTime(1_000_100) // click arrives 100ms after the blur
    tray.click()
    expect(popover.isVisible()).toBe(false)

    // A genuinely new click later re-opens as normal
    vi.setSystemTime(1_001_000)
    tray.click()
    expect(popover.isVisible()).toBe(true)
  })

  it('moves the popover to the clicked display instead of hiding it (visible on another display)', async () => {
    const { tray, popover } = await setup()
    tray.click() // opens on display A (default tray bounds)
    expect(popover.isVisible()).toBe(true)

    // The user clicks the tray icon on display B while the popover is still
    // visible on display A. The intent is "summon it here", not "dismiss".
    const trayBoundsB = { x: 2500, y: 0, width: 24, height: 24 }
    cursorPoint = { x: 2510, y: 10 }
    tray.click(trayBoundsB)

    expect(popover.isVisible()).toBe(true)
    expect(positionPopoverUnderTray).toHaveBeenLastCalledWith(popover, trayBoundsB)
  })

  it('re-opens on the clicked display when the blur-hide happened on another display', async () => {
    // Popover open and focused on display A. The user clicks the tray on
    // display B: mousedown blurs the panel, isCursorOverTray misses (bounds
    // belong to display A), so blur hides the popover. The click that follows
    // within BLUR_TOGGLE_WINDOW_MS must be treated as "summon on display B",
    // not swallowed as the tail end of a same-display dismissal.
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { tray, popover } = await setup()
    tray.click() // open on display A

    cursorPoint = { x: 2510, y: 10 } // cursor on display B's tray icon
    popover.blur()
    expect(popover.isVisible()).toBe(false)

    vi.setSystemTime(1_000_100)
    const trayBoundsB = { x: 2500, y: 0, width: 24, height: 24 }
    tray.click(trayBoundsB)

    expect(popover.isVisible()).toBe(true)
    expect(positionPopoverUnderTray).toHaveBeenLastCalledWith(popover, trayBoundsB)
  })

  it('recreates the popover after it has been destroyed', async () => {
    const { tray, popover } = await setup()
    popover.destroy()

    tray.click()

    expect(createdPopovers.length).toBe(2)
    expect(createdPopovers[1]!.isVisible()).toBe(true)
  })

  it('does not hide when focus moves to another of our windows', async () => {
    const { tray, popover } = await setup()
    tray.click()

    const updateWindow = new FakeWindow()
    allWindows.push(updateWindow)
    updateWindow.focus()
    cursorPoint = CURSOR_AWAY
    popover.blur()

    expect(popover.isVisible()).toBe(true)
  })
})
