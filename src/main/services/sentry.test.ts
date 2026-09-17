import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as fs from 'fs'
import type * as os from 'os'

// vi.mock is hoisted above these imports, so every factory below references
// module-scope mock fns rather than capturing values from the test bodies.

const mockInit = vi.fn()
const mockCaptureException = vi.fn()
const mockCaptureMessage = vi.fn()
const mockCaptureFeedback = vi.fn()
interface MockClient {
  getOptions: () => { enabled: boolean }
  on: (hook: string, callback: (...args: never[]) => void) => void
  close?: (timeout?: number) => Promise<boolean>
}
const mockGetClient = vi.fn<() => MockClient | undefined>()

vi.mock('@sentry/electron/main', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureFeedback: (...args: unknown[]) => mockCaptureFeedback(...args),
  getClient: () => mockGetClient(),
}))

vi.mock('@main/lib/app-config', () => ({
  // Non-empty DSN so _doInit actually runs instead of no-op'ing.
  AppConfig: { sentryDsn: 'https://public@o0.ingest.sentry.io/0' },
}))

vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  rootLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// _readSentryEnabledSync reads preferences.json via fs.readFileSync before
// app.whenReady() — only that one function is overridden, everything else
// (path.join survives via the real 'fs' module) stays real.
const mockReadFileSync = vi.fn<(...args: unknown[]) => string>()
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, readFileSync: (...args: unknown[]) => mockReadFileSync(...args) }
})

// _computeKnownNames() reads os.userInfo().username and os.homedir(); both
// are overridden so tests are deterministic across machines (a real
// os.homedir() would leak this session's actual account name into the
// fixtures below) and so `_readSentryEnabledSync`'s os.homedir()-based path
// building keeps working — it needs a real string, not undefined, or
// path.join throws and every initSentryEarly test would silently regress to
// "opted out" without ever reaching the mocked fs.readFileSync.
const mockUserInfo = vi.fn<() => { username: string }>()
const mockHomedir = vi.fn<() => string>()
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  return { ...actual, userInfo: () => mockUserInfo(), homedir: () => mockHomedir() }
})

interface Integration {
  name: string
}
interface CapturedInitOptions {
  beforeSend: (event: Record<string, unknown>) => Record<string, unknown> | null
  beforeBreadcrumb: (breadcrumb: Record<string, unknown>) => Record<string, unknown> | null
  integrations: (defaults: Integration[]) => Integration[]
}

function capturedOptions(): CapturedInitOptions {
  expect(mockInit).toHaveBeenCalledTimes(1)
  return mockInit.mock.calls[0]?.[0] as CapturedInitOptions
}

interface FeedbackContext {
  message: string
  name?: string
  contact_email?: string
}
interface FeedbackEventLike {
  contexts: { feedback: FeedbackContext }
  extra?: Record<string, unknown>
  tags?: Record<string, unknown>
}

/**
 * Sets up `Sentry.getClient()` to return a fake client exposing `on`, so
 * `_doInit`'s `client.on('beforeSendFeedback', ...)` registration has
 * something to register against, and returns that `on` mock so the test can
 * pull the registered callback back out.
 */
function mockClientWithOn(): ReturnType<typeof vi.fn> {
  const on = vi.fn()
  mockGetClient.mockReturnValue({ getOptions: () => ({ enabled: true }), on })
  return on
}

function capturedFeedbackHook(
  onMock: ReturnType<typeof vi.fn>
): (feedback: FeedbackEventLike) => void {
  const call = onMock.mock.calls.find((call: unknown[]) => call[0] === 'beforeSendFeedback') as
    [string, (feedback: FeedbackEventLike) => void] | undefined
  expect(call).toBeDefined()
  if (!call) throw new Error('beforeSendFeedback hook was never registered')
  return call[1]
}

describe('sentry service', () => {
  beforeEach(() => {
    vi.resetModules()
    mockInit.mockReset()
    mockCaptureException.mockReset()
    mockCaptureMessage.mockReset()
    mockCaptureFeedback.mockReset()
    mockGetClient.mockReset()
    mockGetClient.mockReturnValue(undefined)
    mockReadFileSync.mockReset()
    mockUserInfo.mockReset()
    mockUserInfo.mockReturnValue({ username: 'testuser' })
    mockHomedir.mockReset()
    mockHomedir.mockReturnValue('/Users/testuser')
  })

  describe('initSentry', () => {
    it('does not call Sentry.init when disabled', async () => {
      const { initSentry } = await import('./sentry')
      initSentry(false)
      expect(mockInit).not.toHaveBeenCalled()
    })

    it('calls Sentry.init once when enabled, with an integrations function that removes SentryMinidump', async () => {
      const { initSentry } = await import('./sentry')
      initSentry(true)

      const options = capturedOptions()
      expect(typeof options.integrations).toBe('function')
      const defaults: Integration[] = [
        { name: 'SentryMinidump' },
        { name: 'EventFilters' },
        { name: 'NormalizePaths' },
      ]
      expect(options.integrations(defaults)).toEqual([
        { name: 'EventFilters' },
        { name: 'NormalizePaths' },
      ])
    })

    it('wires a beforeBreadcrumb that scrubs home paths', async () => {
      const { initSentry } = await import('./sentry')
      initSentry(true)

      const options = capturedOptions()
      const scrubbed = options.beforeBreadcrumb({ message: '/Users/alice/app.log' })
      expect(scrubbed).toEqual({ message: '/Users/[user]/app.log' })
    })

    it('beforeSend returns null while disabled and a scrubbed event once enabled', async () => {
      const { initSentry, setSentryEnabled } = await import('./sentry')
      initSentry(true)

      const options = capturedOptions()
      const event = { message: '/Users/alice/x', extra: { p: '/home/bob/y' } }

      expect(options.beforeSend(event)).toEqual({
        message: '/Users/[user]/x',
        extra: { p: '/home/[user]/y' },
      })

      setSentryEnabled(false)
      expect(options.beforeSend(event)).toBeNull()

      setSentryEnabled(true)
      expect(options.beforeSend(event)).toEqual({
        message: '/Users/[user]/x',
        extra: { p: '/home/[user]/y' },
      })
    })
  })

  describe('initSentryEarly', () => {
    it('reads sentryEnabled from preferences.json and inits when true', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ sentryEnabled: true }))
      const { initSentryEarly } = await import('./sentry')

      initSentryEarly()

      expect(mockInit).toHaveBeenCalledTimes(1)
    })

    it('stays opted out (no init) when the preferences file cannot be read', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      const { initSentryEarly } = await import('./sentry')

      initSentryEarly()

      expect(mockInit).not.toHaveBeenCalled()
    })

    it('stays opted out when sentryEnabled is false in preferences.json', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ sentryEnabled: false }))
      const { initSentryEarly } = await import('./sentry')

      initSentryEarly()

      expect(mockInit).not.toHaveBeenCalled()
    })
  })

  describe('setSentryEnabled', () => {
    it('reports restartRequired: true and does not throw when Sentry.init fails (e.g. called after app ready)', async () => {
      const { setSentryEnabled } = await import('./sentry')
      // Mirrors @sentry/electron's real behaviour: Sentry.init() throws
      // synchronously when called after the Electron app's 'ready' event —
      // exactly what happens when the user flips the toggle at runtime.
      mockInit.mockImplementationOnce(() => {
        throw new Error(
          "Sentry SDK should be initialized before the Electron app 'ready' event is fired"
        )
      })

      const result = setSentryEnabled(true)

      expect(result).toEqual({ restartRequired: true })
    })

    it('reports restartRequired: false when Sentry.init succeeds', async () => {
      const { setSentryEnabled } = await import('./sentry')

      const result = setSentryEnabled(true)

      expect(mockInit).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ restartRequired: false })
    })

    it('reports restartRequired: false and does not re-init when already initialised', async () => {
      mockClientWithOn()
      const { initSentry, setSentryEnabled } = await import('./sentry')
      initSentry(true) // already initialised
      expect(mockInit).toHaveBeenCalledTimes(1)

      const result = setSentryEnabled(true)

      expect(mockInit).toHaveBeenCalledTimes(1) // _doInit no-ops once initialised
      expect(result).toEqual({ restartRequired: false })
      expect(mockGetClient()?.getOptions().enabled).toBe(true)
    })

    // @sentry/electron's init() creates the client and binds it to the scope
    // (`scope.setClient(client); client.init()`) BEFORE `configureIPC`, which
    // is the step that throws after app ready. So a failed runtime enable
    // leaves a live, enabled client behind while this module still believes
    // nothing was initialised: uncaught errors were sent while handled ones
    // were not, the session integration still sent its envelope at quit even
    // after crash reports were switched back off, and every further off→on
    // built another client and stacked more process listeners.
    function halfInitialisedClient(): {
      options: { enabled: boolean }
      close: ReturnType<typeof vi.fn>
    } {
      const options = { enabled: true }
      const close = vi.fn(async () => true)
      mockInit.mockImplementation(() => {
        mockGetClient.mockReturnValue({ getOptions: () => options, on: vi.fn(), close })
        throw new Error(
          "Sentry SDK should be initialized before the Electron app 'ready' event is fired"
        )
      })
      return { options, close }
    }

    it('disables and closes the client a failed runtime init left bound', async () => {
      const { options, close } = halfInitialisedClient()
      const { setSentryEnabled } = await import('./sentry')

      expect(setSentryEnabled(true)).toEqual({ restartRequired: true })

      expect(options.enabled).toBe(false)
      expect(close).toHaveBeenCalledTimes(1)
    })

    it('does not call Sentry.init again after a failed runtime init', async () => {
      halfInitialisedClient()
      const { setSentryEnabled } = await import('./sentry')

      setSentryEnabled(true)
      setSentryEnabled(false)
      const again = setSentryEnabled(true)

      expect(mockInit).toHaveBeenCalledTimes(1)
      expect(again).toEqual({ restartRequired: true })
    })

    it('switching off after a failed runtime init disables the bound client', async () => {
      const { options } = halfInitialisedClient()
      const { setSentryEnabled } = await import('./sentry')
      setSentryEnabled(true)
      // Isolate the disable path from the enable path's own clean-up.
      options.enabled = true

      setSentryEnabled(false)

      expect(options.enabled).toBe(false)
    })

    it('does not hand feedback to a half-initialised client', async () => {
      halfInitialisedClient()
      const { setSentryEnabled, captureUserFeedback } = await import('./sentry')
      setSentryEnabled(true)

      expect(captureUserFeedback({ name: '', email: '', message: 'hi' })).toBe(false)
      expect(mockCaptureFeedback).not.toHaveBeenCalled()
    })

    it('reports restartRequired: false for the disable path, which always applies immediately', async () => {
      const { setSentryEnabled } = await import('./sentry')

      const result = setSentryEnabled(false)

      expect(result).toEqual({ restartRequired: false })
    })
  })

  describe('captureMessage', () => {
    it('scrubs home paths before forwarding to Sentry', async () => {
      const { initSentry, captureMessage } = await import('./sentry')
      initSentry(true) // enabled + initialised

      captureMessage('crash near /Users/alice/Workspace/app/src/x.ts')

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'crash near /Users/[user]/Workspace/app/src/x.ts'
      )
    })

    it('does nothing when disabled', async () => {
      const { initSentry, captureMessage } = await import('./sentry')
      initSentry(false)

      captureMessage('/Users/alice/x')

      expect(mockCaptureMessage).not.toHaveBeenCalled()
    })
  })

  describe('captureUserFeedback', () => {
    it('scrubs only the message — name and email are forwarded as typed', async () => {
      const { initSentry, captureUserFeedback } = await import('./sentry')
      initSentry(true)

      const sent = captureUserFeedback({
        name: 'Alice /Users/not-a-path',
        email: 'alice@example.com',
        message: 'seen at /home/alice/.claude/projects/x',
      })

      expect(mockCaptureFeedback).toHaveBeenCalledWith({
        name: 'Alice /Users/not-a-path',
        email: 'alice@example.com',
        message: 'seen at /home/[user]/.claude/projects/x',
      })
      expect(sent).toBe(true)
    })

    it('does nothing, and says so, when not initialised', async () => {
      const { captureUserFeedback } = await import('./sentry')
      // initSentry() was never called in this test — _initialised stays false.

      const sent = captureUserFeedback({
        name: 'Alice',
        email: 'a@example.com',
        message: '/Users/a/x',
      })

      expect(mockCaptureFeedback).not.toHaveBeenCalled()
      expect(sent).toBe(false)
    })

    it('says it did not send when crash reports are off', async () => {
      const { initSentry, setSentryEnabled, captureUserFeedback } = await import('./sentry')
      initSentry(true)
      setSentryEnabled(false)

      expect(captureUserFeedback({ name: '', email: '', message: 'hi' })).toBe(false)
      expect(mockCaptureFeedback).not.toHaveBeenCalled()
    })
  })

  // @sentry/core's captureFeedback only runs `beforeSend` for events with
  // `event.type === undefined` — a feedback event has `type: 'feedback'`, so
  // it skips `beforeSend` entirely and reaches the transport unscrubbed
  // unless a `beforeSendFeedback` client hook scrubs it too. That hook's
  // contract is "mutate the event you're given" (it returns void), which is
  // the one place this module intentionally mutates rather than replacing.
  describe('beforeSendFeedback client hook', () => {
    it('registers a beforeSendFeedback hook on the client after init', async () => {
      const on = mockClientWithOn()
      const { initSentry } = await import('./sentry')

      initSentry(true)

      expect(on).toHaveBeenCalledWith('beforeSendFeedback', expect.any(Function))
    })

    it('deep-scrubs message, contexts, extra and tags, keeping name and email as typed', async () => {
      const on = mockClientWithOn()
      const { initSentry } = await import('./sentry')
      initSentry(true)
      const hook = capturedFeedbackHook(on)

      const feedback: FeedbackEventLike = {
        contexts: {
          feedback: {
            message: 'seen at /Users/alice/.claude/projects/x',
            name: 'Alice /Users/not-a-path',
            contact_email: 'alice@example.com',
          },
        },
        extra: { path: '/home/bob/y' },
        tags: { origin: '/Users/carol/z' },
      }

      hook(feedback) // mutates in place — the hook's return value is ignored

      expect(feedback.contexts.feedback.message).toBe('seen at /Users/[user]/.claude/projects/x')
      expect(feedback.extra).toEqual({ path: '/home/[user]/y' })
      expect(feedback.tags).toEqual({ origin: '/Users/[user]/z' })
      // Name and email are user-typed and sent as typed, even though this
      // one incidentally looks like a path.
      expect(feedback.contexts.feedback.name).toBe('Alice /Users/not-a-path')
      expect(feedback.contexts.feedback.contact_email).toBe('alice@example.com')
    })
  })

  // A real account name can contain punctuation (e.g. "jordan.smith") that
  // Claude Code's project-folder encoding turns into '-'. The generic path
  // patterns in sentry-scrub.ts only redact up to the first such boundary,
  // so sentry.ts computes _knownNames (the OS username + home-dir basename)
  // once at init and threads it through every scrub call so the rest of the
  // name gets caught too — see knownNamePatterns in sentry-scrub.ts.
  describe('known machine-identifying names (OS username / home-dir basename)', () => {
    it('redacts the OS account username, including the part a plain path scrub would leak, via beforeSend', async () => {
      mockUserInfo.mockReturnValue({ username: 'jordan.smith' })
      mockHomedir.mockReturnValue('/Users/jordan.smith')
      const { initSentry } = await import('./sentry')
      initSentry(true)

      const options = capturedOptions()
      const event = {
        message: 'crash for jordan.smith',
        extra: {
          path: '/Users/jordan.smith/.claude/projects/-Users-jordan-smith-app/s.jsonl',
        },
      }
      const out = options.beforeSend(event) as { message: string; extra: { path: string } }

      expect(out.message).not.toMatch(/jordan/i)
      expect(out.message).not.toMatch(/smith/i)
      expect(out.extra.path).not.toMatch(/jordan/i)
      expect(out.extra.path).not.toMatch(/smith/i)
    })

    it('still initialises when os.userInfo() throws', async () => {
      mockUserInfo.mockImplementation(() => {
        throw new Error('no matching entry in the user database')
      })
      const { initSentry } = await import('./sentry')

      initSentry(true)

      expect(mockInit).toHaveBeenCalledTimes(1)
    })
  })
})
