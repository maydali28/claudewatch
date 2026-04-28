import type { BrowserWindow } from 'electron'
import { app, session } from 'electron'

import {
  broadcastToRenderers,
  createDashboardWindow,
  registerDashboardWindowGetter,
} from './window-manager'
import { setupTray, destroyTray } from './tray-manager'
import { registerAllHandlers } from './ipc/router'
import { registerTrayHandlers } from './ipc/tray.handlers'
import { Preferences } from './store/preferences'
import { FileWatcher } from './services/file-watcher'
import { getClaudeDir } from './services/project-scanner'
import { initUpdateService } from './services/update-service'
import { rootLogger as log } from './lib/logger'
import { CHANNELS } from '@shared/ipc/channels'
import { initSentryEarly, initSentry, captureException } from './services/sentry'

app.setName('ClaudeWatch')

// Start as tray-only — hide from Dock (macOS) before the app is ready so it
// never flashes in the Dock on launch.
if (process.platform === 'darwin') {
  app.dock?.hide()
}

// ─── Single-instance lock ─────────────────────────────────────────────────────
// `app.quit()` does not terminate synchronously — it schedules a quit on the
// next tick. Without the early `return` below, bootstrap continues and the
// second instance briefly creates windows, watchers, and tray icons before
// the quit fires, leading to ghost tray icons and double file-watcher events.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  bootstrap()
}

let mainWindow: BrowserWindow | null = null

// Lazy-initialised once the app is ready. Kept at module scope so the
// will-quit handler can call stop() regardless of where it was created.
let fileWatcher: FileWatcher | null = null

// True once the user has confirmed quit (via tray menu or Cmd+Q). Prevents the
// macOS close-button handler from intercepting the actual quit sequence.
let isQuitting = false

function bootstrap(): void {
  // Must run before app.whenReady() — @sentry/electron requires it.
  initSentryEarly()

  // ─── Global error guards ────────────────────────────────────────────────────
  // Without these, an unhandled rejection in a service silently zombies the
  // app — the renderer keeps running but the broken subsystem stays broken
  // until restart. Surface the error in the renderer toast and the log file
  // so users (and we, in bug reports) actually see it.
  const surfaceMainError = (origin: string, err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    log.error(`Unhandled ${origin}:`, err)
    try {
      mainWindow?.webContents.send(CHANNELS.PUSH_MAIN_ERROR, { origin, message, stack })
    } catch {
      /* webContents may be destroyed during shutdown — best-effort */
    }
  }
  process.on('uncaughtException', (err) => {
    captureException(err)
    surfaceMainError('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    captureException(reason)
    surfaceMainError('unhandledRejection', reason)
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.show()
    }
  })

  // ─── App Lifecycle ────────────────────────────────────────────────────────
  app.whenReady().then(async () => {
    log.info('App ready, starting ClaudeWatch...')

    // ── Content Security Policy ──────────────────────────────────────────────
    // Injected via response-header interception so it applies to both the
    // file:// production load and the http://localhost dev-server load.
    // script-src allows only the inline bootstrap Vite injects in dev; in
    // production all scripts come from the same file:// origin ('self').
    const isDev = !!process.env['ELECTRON_RENDERER_URL']
    const scriptSrc = isDev
      ? "'self' 'unsafe-inline' http://localhost:* ws://localhost:*"
      : "'self'"
    // In production, Tailwind v4 compiles to a static CSS file bundled by Vite —
    // no runtime style injection. 'unsafe-inline' is only needed for Vite HMR in dev.
    const styleSrc = isDev ? "'self' 'unsafe-inline'" : "'self'"

    // Zero-egress posture: the renderer is FORBIDDEN from making any network
    // request to a third-party origin. `connect-src 'self'` blocks fetch / XHR
    // / WebSocket / EventSource to anywhere except our own bundle origin (and
    // localhost in dev for Vite HMR). All outbound traffic — update checks,
    // crash reports, telemetry, etc. — must be made from the main process via
    // `net.request()` so it is reviewable in one place. If you ever add a
    // renderer-side ping or analytics script, it WILL fail silently here until
    // you whitelist the origin in connect-src — by design.
    session.defaultSession.webRequest.onHeadersReceived((_details, callback) => {
      callback({
        responseHeaders: {
          ..._details.responseHeaders,
          'Content-Security-Policy': [
            [
              `default-src 'none'`,
              `script-src ${scriptSrc}`,
              `style-src ${styleSrc}`,
              `img-src 'self' data: blob:`,
              `font-src 'self' data:`,
              `connect-src 'self'${isDev ? ' ws://localhost:* http://localhost:*' : ''}`,
              `base-uri 'none'`,
              `form-action 'none'`,
              `frame-ancestors 'none'`,
            ].join('; '),
          ],
        },
      })
    })

    // Load preferences before anything else
    await Preferences.load()
    initSentry(Preferences.get().sentryEnabled)

    // Register all IPC handlers before creating windows so handlers are ready
    // when renderer loads
    registerAllHandlers()
    // Tray handler needs a live reference to mainWindow — injected via closure
    registerTrayHandlers(() => mainWindow)

    // Create the main dashboard window — starts hidden (tray is the entry point).
    mainWindow = createDashboardWindow()

    // ── Window close behaviour ───────────────────────────────────────────────
    // macOS: the red close button hides the window AND removes it from the Dock
    // so it feels truly closed, while the tray remains active.
    // Windows/Linux: closing the last window quits the app.
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        if (process.platform === 'darwin') {
          event.preventDefault()
          mainWindow?.hide()
          // Remove from Dock and Cmd+Tab switcher — tray stays alive
          app.dock?.hide()
        } else {
          // Windows/Linux: hide to tray instead of closing
          event.preventDefault()
          mainWindow?.setSkipTaskbar(true)
          mainWindow?.hide()
        }
      }
    })

    // Null the reference once the window is actually destroyed so we never call
    // methods on a dead BrowserWindow object.
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // Setup system tray (passes mainWindow so tray can show/hide it)
    setupTray(mainWindow)

    // Register the dashboard-window getter centrally so window-manager's
    // `broadcastToRenderers` can fan out push events to both the dashboard
    // and the tray popover without each service threading its own getter.
    // The closure returns the *current* mainWindow reference so macOS window
    // re-creation (activate event below) is handled transparently.
    registerDashboardWindowGetter(() => mainWindow)

    // Initialise update service — wires electron-updater event handlers and
    // pushes PUSH_UPDATE_AVAILABLE to the renderer when an update is found.
    initUpdateService()

    // Start file watcher after handlers are registered and the window exists.
    fileWatcher = new FileWatcher(getClaudeDir(), {
      broadcast: broadcastToRenderers,
      getMainWindow: () => mainWindow,
    })
    fileWatcher.start()
    log.info('FileWatcher started')

    app.on('activate', () => {
      // macOS: re-show window when dock icon is clicked.
      if (mainWindow) {
        app.dock?.show()
        mainWindow.show()
        mainWindow.focus()
      } else {
        // Window was destroyed — re-create it (edge case after force-close).
        mainWindow = createDashboardWindow()
      }
    })
  })

  // ─── Quit coordination ──────────────────────────────────────────────────────
  // Signal that a real quit is in progress so the 'close' handler doesn't
  // intercept it. app.quit() triggers before-quit → will-quit → closed.
  app.on('before-quit', () => {
    isQuitting = true
  })

  // ─── Keep process alive on all windows closed (tray app) ───────────────────
  // On macOS the window hides to tray so this fires when the user Force-Quits
  // via Activity Monitor or the Dock menu. On Windows/Linux there is no
  // hide-to-tray behaviour yet, so we let the process exit normally.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    fileWatcher?.stop()
    destroyTray()
    log.info('App quitting')
  })

  // Disable hardware acceleration if on Linux with software rendering
  if (process.platform === 'linux') {
    app.disableHardwareAcceleration()
  }
}

export { mainWindow }
