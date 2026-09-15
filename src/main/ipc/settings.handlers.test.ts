import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc/channels'
import type { AppPreferences } from '@shared/types/preferences'

// Finding 2 (round-1 review) of Task 17: `settings:set` is the only path that
// writes `pricingOverrides`/`pricingProvider`, and a rate change must refresh
// the scan cache (which in turn busts the worker's metadata cache) so the
// running app reprices without a restart. This test drives that handler
// directly rather than tracing the call chain by hand.

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
  },
}))

vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockGet = vi.fn<() => AppPreferences>()
const mockSet = vi.fn()
vi.mock('@main/store/preferences', () => ({
  Preferences: {
    get: () => mockGet(),
    set: (patch: unknown) => mockSet(patch),
  },
}))

const mockSetSentryEnabled = vi.fn()
const mockCaptureHandlerException = vi.fn()
vi.mock('@main/services/sentry', () => ({
  setSentryEnabled: (...args: unknown[]) => mockSetSentryEnabled(...args),
  captureHandlerException: (...args: unknown[]) => mockCaptureHandlerException(...args),
}))

const mockSetAutostart = vi.fn()
vi.mock('@main/services/autostart', () => ({
  setAutostart: (...args: unknown[]) => mockSetAutostart(...args),
}))

const mockBroadcastToRenderers = vi.fn()
vi.mock('@main/window-manager', () => ({
  broadcastToRenderers: (...args: unknown[]) => mockBroadcastToRenderers(...args),
}))

const mockScanCacheRefresh = vi.fn(async () => ({ projects: [] }))
vi.mock('@main/services/scan-cache', () => ({
  scanCache: { refresh: () => mockScanCacheRefresh() },
}))

const BASE_PREFS: AppPreferences = {
  pricingProvider: 'anthropic',
  pricingOverrides: {},
  secretScanEnabled: false,
  redactionLevel: 'none',
  launchAtLogin: false,
  trayTipDismissed: false,
  theme: 'system',
  sidebarWidth: 280,
  alertedSecrets: [],
  sentryEnabled: false,
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockGet.mockReturnValue(BASE_PREFS)
  handlers.clear()
  vi.resetModules()
  const { registerSettingsHandlers } = await import('./settings.handlers')
  registerSettingsHandlers()
})

async function callSettingsSet(payload: unknown): Promise<unknown> {
  const handler = handlers.get(CHANNELS.SETTINGS_SET)
  if (!handler) throw new Error('settings:set handler was not registered')
  return handler(undefined, payload)
}

describe('settings:set — pricing change cascade', () => {
  it('refreshes the scan cache when the patch changes pricingOverrides', async () => {
    const result = await callSettingsSet({
      pricingOverrides: { 'opus-5': { input: 42 } },
    })

    expect(mockScanCacheRefresh).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('refreshes the scan cache when the patch changes pricingProvider', async () => {
    await callSettingsSet({ pricingProvider: 'anthropic' })

    expect(mockScanCacheRefresh).toHaveBeenCalledTimes(1)
  })

  it('does NOT refresh the scan cache for an unrelated preference patch', async () => {
    const result = await callSettingsSet({ theme: 'dark' })

    expect(mockScanCacheRefresh).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('still reports the settings write as successful if the scan refresh fails', async () => {
    mockScanCacheRefresh.mockRejectedValueOnce(new Error('projects dir unreadable'))

    const result = await callSettingsSet({ pricingOverrides: { 'opus-5': { input: 42 } } })

    expect(result).toEqual({ ok: true, data: undefined })
  })
})
