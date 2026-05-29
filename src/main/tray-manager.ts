import { BrowserWindow, Tray, Menu, nativeImage, app, shell } from 'electron'
import { join } from 'path'
import { createTrayPopoverWindow, positionPopoverUnderTray } from './window-manager'

let tray: Tray | null = null

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function getTrayIconPath(hasAlert = false): string {
  const suffix = hasAlert ? '-alert' : ''
  if (process.platform === 'darwin') {
    // Template images on macOS automatically adapt to dark/light menu bar
    return join(__dirname, `../../resources/tray/trayTemplate${suffix}.png`)
  }
  if (process.platform === 'win32') {
    return join(__dirname, `../../resources/tray/tray${suffix}.ico`)
  }
  // Linux: PNG
  return join(__dirname, `../../resources/tray/tray${suffix}.png`)
}

function buildTrayIcon(hasAlert = false): Electron.NativeImage {
  const iconPath = getTrayIconPath(hasAlert)
  const img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) {
    if (process.platform === 'darwin') img.setTemplateImage(true)
    return img
  }

  // Fallback: try the non-alert variant before giving up
  if (hasAlert) {
    const base = nativeImage.createFromPath(getTrayIconPath(false))
    if (!base.isEmpty()) return base
  }

  // Last resort: 22x22 white circle encoded as a data URL so the tray is always visible
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAABmJLR0QA/wD/AP+gvaeTAAAAZklEQVQ4y2NgGAWDFjAyMv5nYGD4T4VmMFHJXCIxg8lcMjGDyVwyMYPJXDIxg8lcMjGDyVwyMYPJXDIxg8lcMjGDyVwyMYPJXDIxg8lcMjGDyVwyMYPJXDIxg8lcIjEDABcuCg7N3Qg5AAAAAElFTkSuQmCC'
  )
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function buildContextMenu(mainWindow: BrowserWindow, popover: BrowserWindow): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        if (!popover.isDestroyed() && popover.isVisible()) {
          popover.hide()
        }
        if (process.platform === 'darwin') {
          app.dock?.show()
        } else {
          mainWindow.setSkipTaskbar(false)
        }
        mainWindow.show()
        mainWindow.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        mainWindow.webContents.send('push:check-update-request')
      },
    },
    {
      label: 'Show Logs',
      click: () => {
        shell.openPath(app.getPath('logs'))
      },
    },
    { type: 'separator' },
    {
      label: 'Quit ClaudeWatch',
      click: () => app.quit(),
    },
  ])
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function setupTray(mainWindow: BrowserWindow): Tray {
  tray = new Tray(buildTrayIcon())
  tray.setToolTip('ClaudeWatch')

  // Create (but don't show) tray popover window up-front so it loads in the
  // background and pops instantly when the user clicks the tray icon.
  const popover = createTrayPopoverWindow()

  // macOS: set the panel's window level to 'pop-up-menu' — the documented
  // level for menubar-style popovers. Keeps the panel above regular windows
  // but below system overlays (Notification Center, Mission Control).
  if (process.platform === 'darwin') {
    popover.setAlwaysOnTop(true, 'pop-up-menu')
  }

  // Do NOT call setContextMenu on macOS/Windows — it makes left-click show the
  // menu instead of (or in addition to) our popover, causing a double-popup.
  // (Linux uses setContextMenu via the platform branch further down — see
  // there for the explanation.) The menu is built after the popover so the
  // "Open Dashboard" handler can dismiss the popover.
  const contextMenu = buildContextMenu(mainWindow, popover)

  // Auto-dismiss model: the popover hides when it loses focus to anything
  // outside our own windows. Two subtleties make this non-trivial:
  //
  // 1. Re-opening race — clicking the tray while the popover is open fires
  //    `blur` *before* the tray `click` handler. A naive "hide on blur,
  //    toggle on click" sees `isVisible() === false` in the click handler
  //    and re-opens the popover the user just dismissed. Solved here by an
  //    explicit `ignoreNextBlur` flag set by the click handler whenever it
  //    initiates a hide — the blur handler consumes and clears the flag.
  //
  // 2. Show/focus is not atomic on Linux — under many X11 and Wayland
  //    compositors the popover transitions through a transient unfocused
  //    state during `show()`, even though `focus()` was requested. Treating
  //    that transition as a user dismissal makes the popover flash open and
  //    immediately close, requiring a second click to make it stay. The
  //    correct invariant on Linux is: only dismiss-on-blur once the popover
  //    has actually held focus. macOS/Windows deliver focus synchronously
  //    with show(), so the gate is unnecessary there — and on macOS the
  //    popover is a `panel` shown via showInactive(), which doesn't always
  //    fire a real `focus` event, so applying the gate would suppress
  //    every dismissal.
  const requiresFocusGate = process.platform === 'linux'
  let hasBeenFocused = !requiresFocusGate
  let ignoreNextBlur = false

  popover.on('focus', () => {
    hasBeenFocused = true
  })

  popover.on('hide', () => {
    hasBeenFocused = !requiresFocusGate
    ignoreNextBlur = false
  })

  popover.on('blur', () => {
    if (popover.isDestroyed() || !popover.isVisible()) return

    if (ignoreNextBlur) {
      ignoreNextBlur = false
      return
    }

    // Linux only: wait for the popover to actually take focus before
    // honouring blur, otherwise transient unfocused states during show()
    // dismiss it.
    if (!hasBeenFocused) return

    // Don't hide if focus moved to one of our own child windows (update /
    // about / onboarding windows opened from inside the popover).
    const ownWindows = BrowserWindow.getAllWindows().filter((w) => w.id !== popover.id)
    const focusedIsOwn = ownWindows.some((w) => w.isFocused())
    if (focusedIsOwn) return

    popover.hide()
  })

  tray.on('click', (_event, trayBounds) => {
    if (popover.isDestroyed()) return
    if (popover.isVisible()) {
      ignoreNextBlur = true
      popover.hide()
      return
    }

    positionPopoverUnderTray(popover, trayBounds)
    // show() on macOS activates the app and can switch Spaces when the app
    // is hidden from the Dock. showInactive() displays the panel in place
    // on the current Space without triggering app activation.
    if (process.platform === 'darwin') {
      popover.showInactive()
      popover.focus()
    } else {
      popover.show()
      popover.focus()
    }
  })

  // Context menu binding diverges by platform:
  // - Linux (AppIndicator): the `right-click` event never fires. The menu must
  //   be registered via setContextMenu(), which routes the secondary click
  //   automatically. As a side effect, `tray.on('click', ...)` may not fire on
  //   some Linux desktops once a context menu is set — but our popover is
  //   non-essential on Linux (the dashboard is reachable via the menu), so
  //   the trade is acceptable.
  // - macOS / Windows: use `right-click` so a single tray.setContextMenu() call
  //   doesn't intercept left-click, which would replace our custom popover
  //   with the OS menu.
  if (process.platform === 'linux') {
    tray.setContextMenu(contextMenu)
  } else {
    tray.on('right-click', () => {
      tray!.popUpContextMenu(contextMenu)
    })
  }

  return tray
}

export function updateTrayIcon(hasAlert: boolean): void {
  if (!tray) return
  tray.setImage(buildTrayIcon(hasAlert))
}

export function getTray(): Tray | null {
  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
