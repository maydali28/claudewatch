import { app, ipcMain, Notification, shell } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, SecretsDismissSchema } from '@shared/ipc/schemas'
import { captureHandlerException } from '@main/services/sentry'
import { getSecretFindingsStore, getSecretScanService } from '@main/services/secret-scan-service'

/** The OS page where notifications are allowed per app. Fixed here, never from the renderer. */
const NOTIFICATION_SETTINGS_URL: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  win32: 'ms-settings:notifications',
}

export function registerSecretsHandlers(): void {
  ipcMain.handle(CHANNELS.SECRETS_LIST, async () => {
    try {
      return ok(getSecretFindingsStore()?.list() ?? [])
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'SECRETS_FAILED')
    }
  })

  ipcMain.handle(CHANNELS.SECRETS_DISMISS, async (_event, payload) => {
    try {
      const { ids } = validate(SecretsDismissSchema, payload)
      getSecretFindingsStore()?.dismiss(ids)
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'SECRETS_FAILED')
    }
  })

  // An explicit request from Settings › Security; reading the history is the
  // act the user asked for, so it does not wait on the live-scanning switch.
  ipcMain.handle(CHANNELS.SECRETS_SCAN_HISTORY, async () => {
    try {
      const service = getSecretScanService()
      if (!service) throw new Error('Secret scanning is not ready yet')
      return ok(await service.scanHistory())
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'SECRETS_FAILED')
    }
  })

  // Development builds only: shows a sample secret alert at once, so whether
  // the OS lets ClaudeWatch's notifications through can be checked without
  // writing a secret into a transcript.
  if (!app.isPackaged) {
    ipcMain.handle(CHANNELS.SECRETS_TEST_NOTIFICATION, async () => {
      try {
        if (!Notification.isSupported()) return ok({ supported: false })
        new Notification({
          title: 'Secret in a Claude Code session',
          body: 'Test notification: a real alert names the kind of secret and the session.',
        }).show()
        return ok({ supported: true })
      } catch (e) {
        captureHandlerException(e)
        return err(toSafeError(e), 'SECRETS_FAILED')
      }
    })

    ipcMain.handle(CHANNELS.SECRETS_OPEN_NOTIFICATION_SETTINGS, async () => {
      try {
        const url = NOTIFICATION_SETTINGS_URL[process.platform]
        if (!url) return ok({ opened: false })
        await shell.openExternal(url)
        return ok({ opened: true })
      } catch (e) {
        captureHandlerException(e)
        return err(toSafeError(e), 'SECRETS_FAILED')
      }
    })
  }
}
