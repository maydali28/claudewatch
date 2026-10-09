import { ipcMain, shell } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { getNotifier } from '@main/services/notifier'
import { readOsNotificationStatus } from '@main/services/notification-permission'

/** The OS page where notifications are allowed per app. Fixed here, never from the renderer. */
const NOTIFICATION_SETTINGS_URL: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  win32: 'ms-settings:notifications',
}

export function registerNotificationsHandlers(): void {
  // macOS answers from System Settings itself; elsewhere, fall back to what
  // the last notification sent reported.
  ipcMain.handle(CHANNELS.NOTIFICATIONS_STATUS, async () => {
    return ok((await readOsNotificationStatus()) ?? getNotifier()?.status ?? 'unknown')
  })

  // A sample alert, so whether the OS shows ClaudeWatch's notifications can be
  // checked without waiting for a real one. Its outcome arrives as a status push.
  ipcMain.handle(CHANNELS.NOTIFICATIONS_TEST, async () => {
    try {
      const supported =
        getNotifier()?.show({
          title: 'ClaudeWatch',
          body: 'Test notification: secret and cost alerts will show like this.',
        }) ?? false
      return ok({ supported })
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'NOTIFICATIONS_FAILED')
    }
  })

  ipcMain.handle(CHANNELS.NOTIFICATIONS_OPEN_SETTINGS, async () => {
    try {
      const url = NOTIFICATION_SETTINGS_URL[process.platform]
      if (!url) return ok({ opened: false })
      await shell.openExternal(url)
      return ok({ opened: true })
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'NOTIFICATIONS_FAILED')
    }
  })
}
