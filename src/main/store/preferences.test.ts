import { describe, it, expect, vi, beforeEach } from 'vitest'

// `preferences.ts` imports `{ app } from 'electron'` at module scope (only
// `logsPath` actually calls it) and dynamically imports `electron-store`
// inside `load()`. Neither is available under vitest's node environment, so
// both are mocked — same approach as autostart.test.ts and
// settings.handlers.test.ts.
vi.mock('electron', () => ({
  app: { getPath: () => '/fake/logs' },
}))

vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Simulates whatever is already on disk when `Preferences.load()` runs.
// Reassigned per test; the fake store constructor snapshots it once.
let storedData: Record<string, unknown> = {}

vi.mock('electron-store', () => {
  class FakeElectronStore {
    store: Record<string, unknown>
    path = '/fake/preferences.json'
    constructor(opts: { defaults: Record<string, unknown> }) {
      this.store = { ...opts.defaults, ...storedData }
    }
    set(value: Record<string, unknown>): void {
      this.store = { ...this.store, ...value }
    }
    delete(key: string): void {
      const next = { ...this.store }
      delete next[key]
      this.store = next
    }
    clear(): void {
      this.store = {}
    }
  }
  return { default: FakeElectronStore }
})

const VALID_BASE = {
  pricingProvider: 'anthropic',
  secretScanEnabled: false,
  redactionLevel: 'none',
  launchAtLogin: false,
  trayTipDismissed: false,
  theme: 'system',
  sidebarWidth: 280,
  sentryEnabled: false,
}

describe('Preferences.load — secret scan consent', () => {
  beforeEach(() => {
    vi.resetModules()
    storedData = {}
  })

  it('does not take a 1.5.0 "enabled" as consent, and drops what it collected', async () => {
    storedData = { ...VALID_BASE, secretScanEnabled: true, alertedSecrets: ['SEC007:ghp_****abcd'] }

    const { Preferences } = await import('./preferences')
    await Preferences.load()

    const prefs = Preferences.get() as unknown as Record<string, unknown>
    expect(prefs.secretScanEnabled).toBe(false)
    expect(prefs.secretScanConsent).toBe('unasked')
    expect(prefs.alertedSecrets).toBeUndefined()
  })

  it('keeps a recorded answer', async () => {
    storedData = { ...VALID_BASE, secretScanEnabled: true, secretScanConsent: 'granted' }

    const { Preferences } = await import('./preferences')
    await Preferences.load()

    expect(Preferences.get()).toMatchObject({
      secretScanEnabled: true,
      secretScanConsent: 'granted',
    })
  })
})
