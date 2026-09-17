import { describe, it, expect } from 'vitest'
import {
  applyShowUpdate,
  errorHeading,
  initialUpdateState,
  reduceUpdateState,
  retryAction,
  stateFromShowUpdate,
  type UpdateState,
} from './update-state'

const info = { version: '9.9.9', releaseNotes: '- test' }

describe('reduceUpdateState', () => {
  it('walks the happy path idle → checking → available → downloading → ready → installing', () => {
    let s = reduceUpdateState(initialUpdateState, { type: 'check-start' })
    s = reduceUpdateState(s, { type: 'check-ok', info })
    s = reduceUpdateState(s, { type: 'download-start' })
    s = reduceUpdateState(s, { type: 'progress', percent: 42 })
    expect(s).toEqual({ phase: 'downloading', info, progress: 42 })
    s = reduceUpdateState(s, { type: 'download-ok' })
    s = reduceUpdateState(s, { type: 'install-start' })
    expect(s.phase).toBe('installing')
  })

  it('a cancelled install arrives as a service error and lands in error/install with the info kept', () => {
    let s: ReturnType<typeof reduceUpdateState> = { phase: 'installing', info }
    s = reduceUpdateState(s, {
      type: 'service-error',
      error: { phase: 'install', message: 'cancelled', hint: 'chown' },
    })
    expect(s).toEqual({
      phase: 'error',
      failed: 'install',
      message: 'cancelled',
      hint: 'chown',
      info,
    })
    expect(retryAction(s)).toBe('download')
    expect(reduceUpdateState(s, { type: 'retry' })).toEqual({ phase: 'available', info })
  })

  it('progress events are ignored outside downloading', () => {
    const s = reduceUpdateState({ phase: 'ready', info }, { type: 'progress', percent: 99 })
    expect(s).toEqual({ phase: 'ready', info })
  })

  it('a check failure retries by checking again', () => {
    const s = reduceUpdateState({ phase: 'checking' }, { type: 'check-fail', message: 'offline' })
    expect(retryAction(s)).toBe('check')
    expect(reduceUpdateState(s, { type: 'retry' })).toEqual({ phase: 'idle' })
  })

  it('install-start is refused unless ready', () => {
    expect(reduceUpdateState({ phase: 'available', info }, { type: 'install-start' })).toEqual({
      phase: 'available',
      info,
    })
  })

  it('check-ok with no info goes to up-to-date', () => {
    expect(reduceUpdateState({ phase: 'checking' }, { type: 'check-ok', info: null })).toEqual({
      phase: 'up-to-date',
    })
  })

  it('download-start is refused outside available', () => {
    expect(reduceUpdateState({ phase: 'idle' }, { type: 'download-start' })).toEqual({
      phase: 'idle',
    })
  })

  it('a download failure carries the info forward so retry can re-download', () => {
    const s = reduceUpdateState(
      { phase: 'downloading', info, progress: 10 },
      { type: 'download-fail', message: 'net down' }
    )
    expect(s).toEqual({ phase: 'error', failed: 'download', message: 'net down', info })
    expect(retryAction(s)).toBe('download')
    expect(reduceUpdateState(s, { type: 'retry' })).toEqual({ phase: 'available', info })
  })

  it('install-fail is refused outside installing', () => {
    expect(
      reduceUpdateState({ phase: 'ready', info }, { type: 'install-fail', message: 'x' })
    ).toEqual({
      phase: 'ready',
      info,
    })
  })

  it('a service error with no info (e.g. arriving while idle) retries by checking, not downloading', () => {
    const s = reduceUpdateState(
      { phase: 'idle' },
      { type: 'service-error', error: { phase: 'install', message: 'cancelled' } }
    )
    expect(s).toEqual({
      phase: 'error',
      failed: 'install',
      message: 'cancelled',
      hint: undefined,
      info: null,
    })
    expect(retryAction(s)).toBe('check')
    expect(reduceUpdateState(s, { type: 'retry' })).toEqual({ phase: 'idle' })
  })

  it('retryAction is none outside error', () => {
    expect(retryAction({ phase: 'idle' })).toBe('none')
    expect(retryAction({ phase: 'downloading', info, progress: 0 })).toBe('none')
  })

  it('an event that does not apply to the current phase is a no-op', () => {
    const upToDate: UpdateState = { phase: 'up-to-date' }
    expect(reduceUpdateState(upToDate, { type: 'download-ok' })).toEqual(upToDate)
  })

  it('install-fail from installing lands in error/install with the info kept', () => {
    const s = reduceUpdateState(
      { phase: 'installing', info },
      { type: 'install-fail', message: 'boom' }
    )
    expect(s).toEqual({ phase: 'error', failed: 'install', message: 'boom', info })
  })

  it('download-fail is refused outside downloading', () => {
    expect(
      reduceUpdateState({ phase: 'ready', info }, { type: 'download-fail', message: 'x' })
    ).toEqual({ phase: 'ready', info })
  })

  it('retry is refused outside error', () => {
    expect(reduceUpdateState({ phase: 'ready', info }, { type: 'retry' })).toEqual({
      phase: 'ready',
      info,
    })
  })

  it('an install service-error arriving in ready lands in error/install with the info kept — ruling 3 applies regardless of phase', () => {
    const s = reduceUpdateState(
      { phase: 'ready', info },
      { type: 'service-error', error: { phase: 'install', message: 'cancelled' } }
    )
    expect(s).toEqual({
      phase: 'error',
      failed: 'install',
      message: 'cancelled',
      hint: undefined,
      info,
    })
  })

  it('a check service-error is applied while checking', () => {
    const s = reduceUpdateState(
      { phase: 'checking' },
      { type: 'service-error', error: { phase: 'check', message: 'offline' } }
    )
    expect(s).toEqual({
      phase: 'error',
      failed: 'check',
      message: 'offline',
      hint: undefined,
      info: null,
    })
  })

  it('a check service-error is ignored outside checking — it belongs to another surface, e.g. the tray popover polling on open', () => {
    const ready: UpdateState = { phase: 'ready', info }
    expect(
      reduceUpdateState(ready, {
        type: 'service-error',
        error: { phase: 'check', message: 'offline' },
      })
    ).toEqual(ready)

    const available: UpdateState = { phase: 'available', info }
    expect(
      reduceUpdateState(available, {
        type: 'service-error',
        error: { phase: 'check', message: 'offline' },
      })
    ).toEqual(available)
  })

  it('a download service-error is applied while downloading', () => {
    const s = reduceUpdateState(
      { phase: 'downloading', info, progress: 30 },
      { type: 'service-error', error: { phase: 'download', message: 'net down' } }
    )
    expect(s).toEqual({
      phase: 'error',
      failed: 'download',
      message: 'net down',
      hint: undefined,
      info,
    })
  })

  it("a download service-error is ignored outside downloading — it belongs to another surface's download", () => {
    const ready: UpdateState = { phase: 'ready', info }
    expect(
      reduceUpdateState(ready, {
        type: 'service-error',
        error: { phase: 'download', message: 'net down' },
      })
    ).toEqual(ready)
  })
})

describe('errorHeading', () => {
  it('has the exact wording from ruling 5', () => {
    expect(errorHeading('check')).toBe('Update check failed')
    expect(errorHeading('download')).toBe('Download failed')
    expect(errorHeading('install')).toBe('The update was not installed')
  })
})

describe('stateFromShowUpdate', () => {
  it('maps an updateError to error, keyed by its phase, with the info kept', () => {
    expect(
      stateFromShowUpdate({
        updateInfo: info,
        updateError: { phase: 'install', message: 'cancelled', hint: 'chown' },
      })
    ).toEqual({ phase: 'error', failed: 'install', message: 'cancelled', hint: 'chown', info })
  })

  it('an updateError with no updateInfo keeps info null', () => {
    expect(
      stateFromShowUpdate({
        updateInfo: null,
        updateError: { phase: 'check', message: 'offline' },
      })
    ).toEqual({ phase: 'error', failed: 'check', message: 'offline', hint: undefined, info: null })
  })

  it('updateError wins over errorMessage', () => {
    expect(
      stateFromShowUpdate({
        updateInfo: info,
        errorMessage: 'plain check failure',
        updateError: { phase: 'download', message: 'download broke' },
      })
    ).toEqual({
      phase: 'error',
      failed: 'download',
      message: 'download broke',
      hint: undefined,
      info,
    })
  })

  it('errorMessage alone maps to a check failure', () => {
    expect(stateFromShowUpdate({ updateInfo: null, errorMessage: 'offline' })).toEqual({
      phase: 'error',
      failed: 'check',
      message: 'offline',
      info: null,
    })
  })

  it('updateInfo null with no error means up to date', () => {
    expect(stateFromShowUpdate({ updateInfo: null })).toEqual({ phase: 'up-to-date' })
  })

  it('updateInfo present with no error means available', () => {
    expect(stateFromShowUpdate({ updateInfo: info })).toEqual({ phase: 'available', info })
  })

  it('updateInfo entirely absent means still checking', () => {
    expect(stateFromShowUpdate({})).toEqual({ phase: 'checking' })
  })
})

describe('applyShowUpdate', () => {
  it('an updateError always replaces the current state, even mid-download', () => {
    const current: UpdateState = { phase: 'downloading', info, progress: 50 }
    expect(
      applyShowUpdate(current, {
        updateInfo: info,
        updateError: { phase: 'install', message: 'cancelled', hint: 'chown' },
      })
    ).toEqual({ phase: 'error', failed: 'install', message: 'cancelled', hint: 'chown', info })
  })

  it('keeps a downloading state — a reused-window check must not drop progress and reoffer Download', () => {
    const current: UpdateState = { phase: 'downloading', info, progress: 50 }
    expect(applyShowUpdate(current, { updateInfo: info })).toBe(current)
  })

  it('keeps a ready state — a reused-window check must not hide a finished download', () => {
    const current: UpdateState = { phase: 'ready', info }
    expect(applyShowUpdate(current, { updateInfo: info })).toBe(current)
  })

  it('keeps an installing state — a reused-window check must not re-enable buttons mid-install', () => {
    const current: UpdateState = { phase: 'installing', info }
    expect(applyShowUpdate(current, { updateInfo: null })).toBe(current)
  })

  it('otherwise delegates to stateFromShowUpdate', () => {
    const current: UpdateState = { phase: 'idle' }
    expect(applyShowUpdate(current, { updateInfo: info })).toEqual({ phase: 'available', info })
  })
})
