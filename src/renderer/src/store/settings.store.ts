import { create } from 'zustand'
import type { AppPreferences } from '@shared/types'
import { DEFAULT_PREFERENCES } from '@shared/types'
import { CHANNELS } from '@shared/ipc/channels'
import { ipc } from '@renderer/lib/ipc-client'
import { ipcCall } from '@renderer/lib/ipc-call'

interface SettingsState {
  prefs: AppPreferences
  isLoaded: boolean

  loadPrefs(): Promise<void>
  updatePref<K extends keyof AppPreferences>(key: K, value: AppPreferences[K]): Promise<void>
  /** Several preferences in one write, for settings that must change together. */
  updatePrefs(patch: Partial<AppPreferences>): Promise<void>
  applyExternalPrefs(next: AppPreferences): void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  prefs: DEFAULT_PREFERENCES,
  isLoaded: false,

  async loadPrefs() {
    try {
      const result = await ipc.settings.get()
      if (result.ok) {
        set({ prefs: result.data, isLoaded: true })
      }
    } catch {
      // Fall back to defaults if IPC not available (e.g. during tests)
      set({ isLoaded: true })
    }
  },

  async updatePref(key, value) {
    await get().updatePrefs({ [key]: value } as Partial<AppPreferences>)
  },

  async updatePrefs(patch) {
    const prev = get().prefs
    set({ prefs: { ...prev, ...patch } })
    // A refused write (a key main does not accept, an invalid value) comes
    // back as an error result, not a throw; both must undo the optimistic
    // change, or the control shows a value that was never stored.
    const result = await ipcCall(() => ipc.settings.set(patch), {
      errorMessage: 'Could not save the setting',
    })
    if (!result.ok) set({ prefs: prev })
  },

  // Replaces local prefs with the authoritative snapshot pushed by the main
  // process. Used by the PUSH_PREFERENCES_CHANGED subscription below so windows
  // that didn't initiate the change (e.g. the tray popover when settings are
  // edited in the dashboard) re-render with the latest values — without this
  // path the tray would keep its boot-time prefs until the popover reloaded.
  applyExternalPrefs(next: AppPreferences) {
    set({ prefs: next, isLoaded: true })
  },
}))

// Subscribe once at module load. The IPC bridge is unavailable in non-Electron
// contexts (vitest/jsdom); guard so the store remains importable in tests.
if (typeof window !== 'undefined' && window.claudewatch) {
  ipc.on<AppPreferences>(CHANNELS.PUSH_PREFERENCES_CHANGED, (next) => {
    useSettingsStore.getState().applyExternalPrefs(next)
  })
}
