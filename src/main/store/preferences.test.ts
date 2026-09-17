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

describe('Preferences.load — alertedSecrets truncation', () => {
  beforeEach(() => {
    vi.resetModules()
    storedData = {}
  })

  it('truncates an oversized stored alertedSecrets array to the last 500 entries before validation', async () => {
    const oversized = Array.from({ length: 600 }, (_, i) => `secret-${i}`)
    storedData = { ...VALID_BASE, alertedSecrets: oversized }

    const { Preferences } = await import('./preferences')
    await Preferences.load()

    const prefs = Preferences.get()
    expect(prefs.alertedSecrets).toHaveLength(500)
    expect(prefs.alertedSecrets).toEqual(oversized.slice(-500))
  })

  it('leaves an array at or under the cap untouched', async () => {
    const withinCap = Array.from({ length: 500 }, (_, i) => `secret-${i}`)
    storedData = { ...VALID_BASE, alertedSecrets: withinCap }

    const { Preferences } = await import('./preferences')
    await Preferences.load()

    const prefs = Preferences.get()
    expect(prefs.alertedSecrets).toEqual(withinCap)
  })
})
