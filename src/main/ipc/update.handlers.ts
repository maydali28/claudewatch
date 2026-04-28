import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  openBrewUpgrade,
} from '@main/services/update-service'

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
  // Windows/Linux only — macOS uses updates:brew-upgrade
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
  // Windows/Linux only — macOS uses updates:brew-upgrade
  ipcMain.handle(CHANNELS.UPDATES_INSTALL, async () => {
    try {
      installUpdate()
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'UPDATE_INSTALL_FAILED')
    }
  })

  // ── updates:brew-upgrade ───────────────────────────────────────────────────
  // macOS only — opens Terminal and runs `brew upgrade --cask claudewatch`
  ipcMain.handle(CHANNELS.UPDATES_BREW_UPGRADE, () => {
    try {
      openBrewUpgrade()
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'UPDATE_BREW_UPGRADE_FAILED')
    }
  })
}
