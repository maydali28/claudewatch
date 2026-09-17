import { describe, expect, it } from 'vitest'
import { shouldShowRestartBanner } from './restart-banner'

describe('shouldShowRestartBanner', () => {
  it('shows the banner when the toggle switches from off to on', () => {
    expect(shouldShowRestartBanner(false, true)).toBe(true)
  })

  it('does not show the banner when turning the toggle off', () => {
    expect(shouldShowRestartBanner(true, false)).toBe(false)
  })

  it('does not show the banner when it was already on and stays on', () => {
    expect(shouldShowRestartBanner(true, true)).toBe(false)
  })

  it('does not show the banner when it was already off and stays off', () => {
    expect(shouldShowRestartBanner(false, false)).toBe(false)
  })
})
