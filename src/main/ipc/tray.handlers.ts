import type { BrowserWindow } from 'electron'
import { ipcMain, app } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, TrayOpenDashboardSchema, TrayShowOnboardingSchema } from '@shared/ipc/schemas'
import {
  getTrayPopoverWindow,
  createOrShowUpdateWindow,
  createOrShowAboutWindow,
  createOrShowOnboardingWindow,
} from '@main/window-manager'
import { checkForUpdate } from '@main/services/update-service'

/**
 * Handle tray:open-dashboard — show and focus the main dashboard window.
 * Optionally sends a push event to the renderer to navigate to a specific session.
 * getMainWindow is injected to avoid circular imports.
 */
export function registerTrayHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(CHANNELS.TRAY_OPEN_DASHBOARD, (_event, raw) => {
    try {
      const navigationTarget = validate(TrayOpenDashboardSchema, raw)
      const dashboardWindow = getMainWindow()
      if (dashboardWindow) {
        // Restore OS taskbar/Dock presence before showing
        if (process.platform === 'darwin') {
          app.dock?.show()
        } else {
          dashboardWindow.setSkipTaskbar(false)
        }
        if (dashboardWindow.isMinimized()) dashboardWindow.restore()

        // Bring the window to the user's current Space instead of switching
        // them to wherever the window was last shown. The visibleOnAllWorkspaces
        // toggle is the documented macOS-only pattern: enabling it pulls the
        // window onto the active Space; we revert immediately so it doesn't
        // float across Spaces afterwards.
        if (process.platform === 'darwin') {
          dashboardWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        }
        dashboardWindow.show()
        dashboardWindow.focus()
        if (process.platform === 'darwin') {
          dashboardWindow.setVisibleOnAllWorkspaces(false)
        }

        // Tell the dashboard renderer to navigate to the requested session
        if (navigationTarget?.sessionId && navigationTarget?.projectId) {
          dashboardWindow.webContents.send('push:navigate-session', {
            sessionId: navigationTarget.sessionId,
            projectId: navigationTarget.projectId,
          })
        }
      }

      // Hide the tray popover after launching dashboard
      const popover = getTrayPopoverWindow()
      if (popover?.isVisible()) popover.hide()

      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'TRAY_OPEN_FAILED')
    }
  })

  ipcMain.handle(CHANNELS.TRAY_SHOW_ABOUT, () => {
    const popover = getTrayPopoverWindow()
    if (popover?.isVisible()) popover.hide()
    createOrShowAboutWindow()
    return ok(undefined)
  })

  ipcMain.handle(CHANNELS.TRAY_SHOW_UPDATE, async () => {
    const popover = getTrayPopoverWindow()
    if (popover?.isVisible()) popover.hide()

    try {
      const info = await checkForUpdate()
      createOrShowUpdateWindow(info ?? null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      createOrShowUpdateWindow(null, message)
    }
    return ok(undefined)
  })

  ipcMain.handle(CHANNELS.TRAY_SHOW_ONBOARDING, (_event, raw) => {
    try {
      const { launchAtLogin } = validate(TrayShowOnboardingSchema, raw)
      const popover = getTrayPopoverWindow()
      if (popover?.isVisible()) popover.hide()
      createOrShowOnboardingWindow(launchAtLogin)
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'TRAY_ONBOARDING_FAILED')
    }
  })

  ipcMain.handle(CHANNELS.APP_QUIT, () => {
    app.quit()
    return ok(undefined)
  })

  ipcMain.handle(CHANNELS.APP_RELAUNCH, () => {
    app.relaunch()
    app.releaseSingleInstanceLock()
    app.quit()
    return ok(undefined)
  })
}
