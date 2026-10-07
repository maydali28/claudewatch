import { describe, expect, it } from 'vitest'
import {
  addonPath,
  readOsNotificationStatus,
  toNotificationStatus,
} from './notification-permission'

describe('toNotificationStatus', () => {
  it('maps macOS’s answer onto the app’s status', () => {
    expect(toNotificationStatus('authorized')).toBe('allowed')
    expect(toNotificationStatus('provisional')).toBe('allowed')
    expect(toNotificationStatus('denied')).toBe('blocked')
    expect(toNotificationStatus('notDetermined')).toBe('unknown')
    expect(toNotificationStatus('something new')).toBeNull()
  })
})

describe('addonPath', () => {
  it('points beside the main bundle, outside app.asar once packaged', () => {
    expect(addonPath('/x/out/main')).toBe('/x/out/native/notification-status.node')
    expect(addonPath('/A.app/Contents/Resources/app.asar/out/main')).toBe(
      '/A.app/Contents/Resources/app.asar.unpacked/out/native/notification-status.node'
    )
  })
})

describe('readOsNotificationStatus', () => {
  it('cannot ask anywhere but macOS', async () => {
    expect(await readOsNotificationStatus({ platform: 'linux', load: () => null })).toBeNull()
  })

  it('cannot ask when the addon is missing', async () => {
    expect(await readOsNotificationStatus({ platform: 'darwin', load: () => null })).toBeNull()
  })

  it('reads the addon’s answer', async () => {
    const load = () => ({ status: async () => 'denied' })
    expect(await readOsNotificationStatus({ platform: 'darwin', load })).toBe('blocked')
  })

  it('treats an addon error as not knowing', async () => {
    const load = () => ({
      status: async () => {
        throw new Error('boom')
      },
    })
    expect(await readOsNotificationStatus({ platform: 'darwin', load })).toBeNull()
  })
})
