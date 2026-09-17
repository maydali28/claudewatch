import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, FeedbackSubmitSchema } from '@shared/ipc/schemas'
import { captureUserFeedback, captureHandlerException } from '@main/services/sentry'

export function registerFeedbackHandlers(): void {
  ipcMain.handle(CHANNELS.FEEDBACK_SUBMIT, async (_event, payload) => {
    try {
      const { name, email, message } = validate(FeedbackSubmitSchema, payload)
      // The form is shown whenever the preference is on, which includes the
      // window between switching crash reports on and restarting — when the
      // SDK is not running yet. Say so rather than "Feedback sent".
      if (!captureUserFeedback({ name, email, message })) {
        return err('Restart ClaudeWatch to send feedback.')
      }
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })
}
