import { BrowserWindow, Tray, Menu, nativeImage, app, screen, shell } from 'electron'
import { join } from 'path'
import {
  createTrayPopoverWindow,
  getTrayPopoverWindow,
  positionPopoverUnderTray,
} from './window-manager'

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

function buildContextMenu(getMainWindow: () => BrowserWindow | null): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        // Read both windows through their module-level/injected getters at
        // click time — either instance can be destroyed and re-created at
        // runtime (a cancelled install destroys the dashboard window, and
        // `index.ts`'s disarm listener re-creates it — see update-quit.ts), so
        // a reference captured when the menu was built would go stale.
        const popover = getTrayPopoverWindow()
        if (popover && !popover.isDestroyed() && popover.isVisible()) {
          popover.hide()
        }
        const mainWindow = getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) return
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
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('push:check-update-request')
        }
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

/**
 * True when the mouse cursor is currently inside the tray icon's bounds.
 * Used by the popover blur handler to recognise "this blur was caused by a
 * click on the tray icon" — in that case the tray `click` handler owns the
 * toggle. Returns false when the platform reports no usable tray geometry
 * (e.g. Linux AppIndicator).
 */
function isCursorOverTray(): boolean {
  if (!tray) return false
  const bounds = tray.getBounds()
  if (bounds.width === 0 || bounds.height === 0) return false
  const point = screen.getCursorScreenPoint()
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}

// Clicking the tray while the popover is open and focused fires `blur`
// *before* the tray `click` event. When the blur handler can't attribute the
// blur to a tray click (see isCursorOverTray — tray geometry is unreliable on
// some platforms/multi-display setups) it hides the popover and records the
// time here; a tray click arriving within this window ON THE SAME DISPLAY is
// the second half of that same dismissal and must not re-open the popover.
// A click from a different display is a summon, not a dismissal — see the
// click handler.
const BLUR_TOGGLE_WINDOW_MS = 300

/** Display the window currently occupies, judged by its top-center point. */
function displayIdOf(win: BrowserWindow): number {
  const b = win.getBounds()
  return screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y }).id
}

export function setupTray(getMainWindow: () => BrowserWindow | null): Tray {
  tray = new Tray(buildTrayIcon())
  tray.setToolTip('ClaudeWatch')

  let hiddenByBlurAt = 0
  let hiddenByBlurDisplayId = -1

  // Auto-dismiss model: the popover hides when it loses focus to anything
  // outside our own windows. Two subtleties make this non-trivial:
  //
  // 1. Re-opening race — clicking the tray while the popover is open fires
  //    `blur` *before* the tray `click` handler. A naive "hide on blur,
  //    toggle on click" sees `isVisible() === false` in the click handler
  //    and re-opens the popover the user just dismissed. Handled twice over:
  //    the blur handler skips hiding when the cursor is over the tray icon
  //    (the click handler completes the toggle), and the click handler
  //    ignores clicks that arrive within BLUR_TOGGLE_WINDOW_MS of a
  //    blur-initiated hide for the cases where tray geometry lies.
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
  function initPopover(): BrowserWindow {
    // Created (but not shown) up-front so it loads in the background and pops
    // instantly when the user clicks the tray icon.
    const win = createTrayPopoverWindow()

    // macOS: set the panel's window level to 'pop-up-menu' — the documented
    // level for menubar-style popovers. Keeps the panel above regular windows
    // but below system overlays (Notification Center, Mission Control).
    if (process.platform === 'darwin') {
      win.setAlwaysOnTop(true, 'pop-up-menu')
    }

    const requiresFocusGate = process.platform === 'linux'
    let hasBeenFocused = !requiresFocusGate

    win.on('focus', () => {
      hasBeenFocused = true
    })

    win.on('hide', () => {
      hasBeenFocused = !requiresFocusGate
    })

    win.on('blur', () => {
      if (win.isDestroyed() || !win.isVisible()) return

      // Blur caused by a click on the tray icon — the tray click handler
      // fires next and owns the toggle. Hiding here would make that click
      // see a hidden popover and re-open it.
      if (isCursorOverTray()) return

      // Linux only: wait for the popover to actually take focus before
      // honouring blur, otherwise transient unfocused states during show()
      // dismiss it.
      if (!hasBeenFocused) return

      // Don't hide if focus moved to one of our own child windows (update /
      // about / onboarding windows opened from inside the popover).
      const ownWindows = BrowserWindow.getAllWindows().filter((w) => w.id !== win.id)
      const focusedIsOwn = ownWindows.some((w) => w.isFocused())
      if (focusedIsOwn) return

      // Remember where the popover was when this blur hid it — the tray
      // click handler uses it to tell a same-display dismissal apart from a
      // cross-display summon.
      hiddenByBlurDisplayId = displayIdOf(win)
      win.hide()
      hiddenByBlurAt = Date.now()
    })

    return win
  }

  let popover = initPopover()

  // Do NOT call setContextMenu on macOS/Windows — it makes left-click show the
  // menu instead of (or in addition to) our popover, causing a double-popup.
  // (Linux uses setContextMenu via the platform branch further down — see
  // there for the explanation.)
  const contextMenu = buildContextMenu(getMainWindow)

  tray.on('click', (_event, trayBounds) => {
    // The popover can still be destroyed by forces outside our control
    // (e.g. a crashed window). Re-create it instead of leaving the tray dead.
    if (popover.isDestroyed()) {
      popover = initPopover()
    }

    const cursorDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id

    const showPopover = (): void => {
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
    }

    if (popover.isVisible()) {
      // Toggle-close only applies on the display the popover is on. A click
      // from another display means "show it here" — reposition instead of
      // hiding, or the user sees their click do nothing.
      if (displayIdOf(popover) === cursorDisplayId) {
        popover.hide()
        return
      }
      showPopover()
      return
    }

    // This click's mousedown already dismissed the popover via blur — don't
    // treat the mouseup as a request to re-open it. Only applies when the
    // dismissal happened on the display being clicked; a cross-display click
    // is a summon, not the tail end of a dismissal.
    if (
      Date.now() - hiddenByBlurAt < BLUR_TOGGLE_WINDOW_MS &&
      hiddenByBlurDisplayId === cursorDisplayId
    ) {
      return
    }

    showPopover()
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
