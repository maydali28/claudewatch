import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, FeedbackSubmitSchema } from '@shared/ipc/schemas'
import { captureUserFeedback, captureHandlerException } from '@main/services/sentry'

export function registerFeedbackHandlers(): void {
  ipcMain.handle(CHANNELS.FEEDBACK_SUBMIT, async (_event, payload) => {
    try {
      const { name, email, message } = validate(FeedbackSubmitSchema, payload)
      captureUserFeedback({ name, email, message })
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })
}
