import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { checkForUpdate, downloadUpdate, installUpdate } from '@main/services/update-service'

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
}
