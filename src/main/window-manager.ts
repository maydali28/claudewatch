import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { Preferences } from './store/preferences'
import type { UpdateInfo } from '@shared/types/project'

const IS_DEV = !app.isPackaged

// In electron-vite, the renderer dev server URL is injected as an env var.
// In production the renderer is loaded as a static file from out/renderer/.
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

const PRELOAD_PATH = join(__dirname, '../preload/index.js')

function getAppIconPath(): string {
  if (process.platform === 'win32') return join(__dirname, '../../resources/icons/icon.ico')
  if (process.platform === 'linux') return join(__dirname, '../../resources/icons/icon.png')
  // macOS: icon is set via the .icns in the app bundle — no need to set it on BrowserWindow
  return join(__dirname, '../../resources/icons/icon.icns')
}

// ─── Dashboard Window ─────────────────────────────────────────────────────────

export function createDashboardWindow(): BrowserWindow {
  const prefs = Preferences.get()
  const bounds = prefs.windowBounds

  const defaultWidth = 1280
  const defaultHeight = 800

  const win = new BrowserWindow({
    width: bounds?.width ?? defaultWidth,
    height: bounds?.height ?? defaultHeight,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Hidden from taskbar on launch — set to false when the window is first shown
    skipTaskbar: process.platform !== 'darwin',
    icon: process.platform !== 'darwin' ? getAppIconPath() : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      devTools: IS_DEV,
      preload: PRELOAD_PATH,
    },
  })

  // Block all window.open / target=_blank navigations — open in system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  // Block in-page navigations away from our own origin (defence-in-depth).
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = IS_DEV ? url.startsWith('http://localhost') : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url).catch(() => {})
      }
    }
  })

  // Don't auto-show on ready — the app starts tray-only.
  // The dashboard is shown explicitly when the user opens it from the tray.

  const saveBounds = (): void => {
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      const b = win.getBounds()
      Preferences.set({ windowBounds: b })
    }
  }
  win.on('resize', saveBounds)
  win.on('moved', saveBounds)

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ─── Dashboard Window Registration ────────────────────────────────────────────
//
// The dashboard BrowserWindow is owned by `main/index.ts` (it is re-created on
// macOS `activate` after being destroyed), so we register a getter here rather
// than store the window itself. Services that need to push to the dashboard
// read through this getter, and `broadcastToRenderers` below fans out to every
// renderer surface that displays session data.

let getDashboardWindow: () => BrowserWindow | null = () => null

export function registerDashboardWindowGetter(getter: () => BrowserWindow | null): void {
  getDashboardWindow = getter
}

export function getMainWindow(): BrowserWindow | null {
  return getDashboardWindow()
}

/**
 * Send a push event to every renderer surface that displays live session data.
 *
 * Today that's the dashboard window and the tray popover window. Add new
 * surfaces here when they need push updates — services should never call
 * `webContents.send` on individual windows for broadcast-style events, or the
 * tray will silently go stale again.
 */
export function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const win of [getDashboardWindow(), getTrayPopoverWindow()]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

// ─── Tray Popover Window ──────────────────────────────────────────────────────

let trayPopoverWindow: BrowserWindow | null = null

export function createTrayPopoverWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Rounded corners via transparent background + CSS
    transparent: process.platform === 'darwin',
    hasShadow: true,
    // `panel` on macOS prevents the Space-switch / Dock-activation that
    // happens when a regular window is shown+focused while the app is
    // hidden from the Dock. This is how Raycast / native menubar apps behave.
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: IS_DEV,
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  // Show on whichever Space the user is currently on instead of switching
  // to the Space where the main window lives.
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  // NOTE: the blur → hide behaviour lives in tray-manager.ts because it needs
  // to consult the tray's bounds to distinguish "user clicked the tray icon"
  // (let the tray click handler toggle) from "user clicked elsewhere" (hide).

  // Load tray popover with ?window=tray query param so renderer knows which
  // root component to mount
  if (DEV_SERVER_URL) {
    win.loadURL(`${DEV_SERVER_URL}?window=tray`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'tray' },
    })
  }

  trayPopoverWindow = win
  return win
}

export function getTrayPopoverWindow(): BrowserWindow | null {
  return trayPopoverWindow
}

// ─── Update Window ────────────────────────────────────────────────────────────

let updateWindow: BrowserWindow | null = null

export function createOrShowUpdateWindow(
  updateInfo: UpdateInfo | null,
  errorMessage?: string
): BrowserWindow {
  if (updateWindow && !updateWindow.isDestroyed()) {
    // Already open — push fresh data and focus
    updateWindow.webContents.send('push:show-update', { updateInfo, errorMessage })
    updateWindow.show()
    updateWindow.focus()
    return updateWindow
  }

  const win = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 460,
    minHeight: 500,
    maxWidth: 680,
    maxHeight: 800,
    useContentSize: true,
    resizable: true,
    center: true,
    show: false,
    title: 'ClaudeWatch — Updates',
    icon: process.platform !== 'darwin' ? getAppIconPath() : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: IS_DEV,
      preload: PRELOAD_PATH,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    updateWindow = null
  })

  // Encode update data as query params so the renderer reads them synchronously
  // on mount — avoids the IPC timing race where ready-to-show fires before
  // the React useEffect listener is registered.
  const query: Record<string, string> = { window: 'update', updateInfo: JSON.stringify(updateInfo) }
  if (errorMessage) query['errorMessage'] = errorMessage
  if (DEV_SERVER_URL) {
    const qs = new URLSearchParams(query).toString()
    win.loadURL(`${DEV_SERVER_URL}?${qs}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }

  updateWindow = win
  return win
}

export function getUpdateWindow(): BrowserWindow | null {
  return updateWindow
}

// ─── About Window ─────────────────────────────────────────────────────────────

let aboutWindow: BrowserWindow | null = null

export function createOrShowAboutWindow(): BrowserWindow {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show()
    aboutWindow.focus()
    return aboutWindow
  }

  const win = new BrowserWindow({
    width: 420,
    height: 400,
    useContentSize: true,
    resizable: false,
    center: true,
    show: false,
    title: 'About ClaudeWatch',
    icon: process.platform !== 'darwin' ? getAppIconPath() : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: IS_DEV,
      preload: PRELOAD_PATH,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    aboutWindow = null
  })

  if (DEV_SERVER_URL) {
    win.loadURL(`${DEV_SERVER_URL}?window=about`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'about' } })
  }

  aboutWindow = win
  return win
}

// ─── Onboarding Window ────────────────────────────────────────────────────────

let onboardingWindow: BrowserWindow | null = null

export function createOrShowOnboardingWindow(launchAtLogin: boolean): BrowserWindow {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.webContents.send('push:show-onboarding', { launchAtLogin })
    onboardingWindow.show()
    onboardingWindow.focus()
    return onboardingWindow
  }

  const win = new BrowserWindow({
    width: 400,
    height: 360,
    useContentSize: true,
    resizable: false,
    center: true,
    show: false,
    title: 'Welcome to ClaudeWatch',
    icon: process.platform !== 'darwin' ? getAppIconPath() : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: IS_DEV,
      preload: PRELOAD_PATH,
    },
  })

  win.once('ready-to-show', () => {
    win.webContents.send('push:show-onboarding', { launchAtLogin })
    win.show()
  })

  win.on('closed', () => {
    onboardingWindow = null
  })

  if (DEV_SERVER_URL) {
    win.loadURL(`${DEV_SERVER_URL}?window=onboarding`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'onboarding' } })
  }

  onboardingWindow = win
  return win
}

/**
 * Position the tray popover window directly below a tray icon.
 * trayBounds comes from tray.getBounds() (only reliable on macOS/Windows).
 */
export function positionPopoverUnderTray(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  const { width: popW, height: popH } = win.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  })
  const { bounds: dBounds } = display

  // Center horizontally over tray icon, snap below it
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - popW / 2)
  let y = Math.round(trayBounds.y + trayBounds.height + 4)

  // Keep within display bounds
  x = Math.max(dBounds.x, Math.min(x, dBounds.x + dBounds.width - popW))
  y = Math.max(dBounds.y, Math.min(y, dBounds.y + dBounds.height - popH))

  win.setPosition(x, y, false)
}
