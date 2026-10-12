import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, SecretsDismissSchema } from '@shared/ipc/schemas'
import { captureHandlerException } from '@main/services/sentry'
import { getSecretFindingsStore, getSecretScanService } from '@main/services/secret-scan-service'

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
}
