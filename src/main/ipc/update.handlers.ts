import { ipcMain, BrowserWindow } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, UpdatesResizeSchema } from '@shared/ipc/schemas'
import { captureHandlerException } from '@main/services/sentry'
import { checkForUpdate, downloadUpdate, installUpdate } from '@main/services/update-service'
import { getUpdateWindow, centerUpdateWindowOnFirstResize } from '@main/window-manager'
import { UPDATE_WINDOW_WIDTH, clampUpdateWindowHeight } from '@shared/utils/update-window-size'

export function registerUpdateHandlers(): void {
  // ── updates:check ──────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.UPDATES_CHECK, async () => {
    try {
      const info = await checkForUpdate()
      return ok(info)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'UPDATE_CHECK_FAILED')
    }
  })

  // ── updates:download ───────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.UPDATES_DOWNLOAD, async () => {
    try {
      await downloadUpdate()
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'UPDATE_DOWNLOAD_FAILED')
    }
  })

  // ── updates:install ────────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.UPDATES_INSTALL, async () => {
    try {
      await installUpdate()
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'UPDATE_INSTALL_FAILED')
    }
  })

  // ── updates:resize-window ──────────────────────────────────────────────────
  // The renderer measures its own content (ResizeObserver on the root element,
  // see update-window.tsx) and asks for a content height; the measurement is
  // untrusted, so it's clamped again here before ever reaching the window. The
  // sender is required to be the live update window so no other surface can
  // resize it.
  ipcMain.handle(CHANNELS.UPDATES_RESIZE_WINDOW, (event, raw) => {
    try {
      const { height } = validate(UpdatesResizeSchema, raw)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed() || win !== getUpdateWindow()) return ok(undefined)
      win.setContentSize(UPDATE_WINDOW_WIDTH, clampUpdateWindowHeight(height), true)
      centerUpdateWindowOnFirstResize(win)
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'UPDATE_RESIZE_FAILED')
    }
  })
}
