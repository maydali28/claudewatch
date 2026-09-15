import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, SettingsSetSchema } from '@shared/ipc/schemas'
import { Preferences } from '@main/store/preferences'
import { setSentryEnabled, captureHandlerException } from '@main/services/sentry'
import { setAutostart } from '@main/services/autostart'
import { broadcastToRenderers } from '@main/window-manager'
import { scanCache } from '@main/services/scan-cache'
import { createLogger } from '@main/lib/logger'

const log = createLogger('Settings')

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
        await setAutostart(settingsPatch.launchAtLogin)
      }

      if (typeof settingsPatch.sentryEnabled === 'boolean') {
        setSentryEnabled(settingsPatch.sentryEnabled)
      }

      // A rate change leaves every already-scanned session's cost stale: the
      // in-memory scan cache holds summaries computed under the old table,
      // and the worker's on-disk metadata cache would otherwise keep serving
      // them right back on the next read. Refreshing here recomputes with
      // the new active table and, via its pricing fingerprint, discards the
      // stale disk entries too — one call covers both caches.
      if ('pricingProvider' in settingsPatch || 'pricingOverrides' in settingsPatch) {
        // Best-effort: the preference write already succeeded, and a scan
        // failure here (e.g. an unreadable projects dir) shouldn't be
        // reported back as the settings write itself failing.
        try {
          await scanCache.refresh()
        } catch (error) {
          log.warn('Failed to refresh scan cache after a pricing change:', error)
        }
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
