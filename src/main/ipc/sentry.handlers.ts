import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok } from '@shared/ipc/contracts'
import { validate, SentryCaptureExceptionSchema } from '@shared/ipc/schemas'
import { captureException } from '@main/services/sentry'

export function registerSentryHandlers(): void {
  ipcMain.handle(CHANNELS.SENTRY_CAPTURE_EXCEPTION, (_event, payload) => {
    try {
      const { message, stack, origin } = validate(SentryCaptureExceptionSchema, payload)
      const err = new Error(message)
      err.stack = stack ?? `Error: ${message}\n    at renderer (${origin})`
      captureException(err)
    } catch {
      // Never let error reporting itself crash the main process
    }
    return ok(undefined)
  })
}
