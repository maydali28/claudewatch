import { describe, expect, it } from 'vitest'
import { SettingsSetSchema } from './schemas'

describe('SettingsSetSchema', () => {
  it('accepts every key the window writes, alone or together', () => {
    for (const patch of [
      { lastSeenVersion: '1.6.0' },
      { secretScanEnabled: true, secretScanConsent: 'granted' },
      { redactionLevel: 'remove' },
      { theme: 'dark' },
    ]) {
      expect(SettingsSetSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(true)
    }
  })

  it('rejects a key it does not know instead of dropping it', () => {
    expect(SettingsSetSchema.safeParse({ notASetting: true }).success).toBe(false)
    expect(SettingsSetSchema.safeParse({ theme: 'dark', notASetting: true }).success).toBe(false)
  })

  it('rejects an empty patch', () => {
    expect(SettingsSetSchema.safeParse({}).success).toBe(false)
  })
})
