import { ipcMain, app } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, SettingsSetSchema } from '@shared/ipc/schemas'
import { Preferences } from '@main/store/preferences'
import { setSentryEnabled, captureHandlerException } from '@main/services/sentry'
import { broadcastToRenderers } from '@main/window-manager'

export function registerSettingsHandlers(): void {
  ipcMain.handle(CHANNELS.SETTINGS_GET, async () => {
    try {
      return ok(Preferences.get())
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })

  ipcMain.handle(CHANNELS.SETTINGS_SET, async (_event, payload) => {
    try {
      const settingsPatch = validate(SettingsSetSchema, payload)
      Preferences.set(settingsPatch)

      if (typeof settingsPatch.launchAtLogin === 'boolean') {
        app.setLoginItemSettings({ openAtLogin: settingsPatch.launchAtLogin })
      }

      if (typeof settingsPatch.sentryEnabled === 'boolean') {
        setSentryEnabled(settingsPatch.sentryEnabled)
      }

      // Notify every renderer surface so windows that mounted with stale prefs
      // (e.g. the tray popover, which loads prefs once at startup) re-sync.
      // Send the canonical post-write snapshot from Preferences rather than the
      // patch itself — guarantees all surfaces converge on the same state even
      // if a later migration or coercion changed the persisted value.
      const { sessionTags: _sessionTags, ...nextPrefs } = Preferences.get()
      broadcastToRenderers(CHANNELS.PUSH_PREFERENCES_CHANGED, nextPrefs)

      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })
}
