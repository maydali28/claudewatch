import { describe, it, expect } from 'vitest'
import { canInstallInApp, MANUAL_UPDATE_COMMAND } from './update-install-support'

describe('canInstallInApp', () => {
  it('is true where electron-updater stages and installs the update', () => {
    expect(canInstallInApp('darwin')).toBe(true)
    expect(canInstallInApp('win32')).toBe(true)
  })

  it('is false on linux, where "Download" could only ever fail', () => {
    expect(canInstallInApp('linux')).toBe(false)
  })

  it('is false for any platform we have not shipped an in-app installer for', () => {
    expect(canInstallInApp('freebsd')).toBe(false)
    expect(canInstallInApp('')).toBe(false)
  })
})

describe('MANUAL_UPDATE_COMMAND', () => {
  it('names the package, so the text can be copied as-is', () => {
    expect(MANUAL_UPDATE_COMMAND).toBe('sudo apt upgrade claudewatch')
  })
})
