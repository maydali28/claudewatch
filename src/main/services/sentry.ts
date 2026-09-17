import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as Sentry from '@sentry/electron/main'
import { createLogger } from '@main/lib/logger'
import { AppConfig } from '@main/lib/app-config'
import { scrubDeep, scrubEvent, scrubText } from './sentry-scrub'

const log = createLogger('Sentry')

const DSN = AppConfig.sentryDsn || undefined

let _initialised = false
let _enabled = false
/**
 * True once a runtime `Sentry.init()` has thrown. @sentry/electron creates the
 * client and binds it to the scope (`scope.setClient(client); client.init()`)
 * before `configureIPC`, the step that throws once the app is ready — so the
 * failure leaves a live, enabled client behind even though `_initialised`
 * stays false. That client is shut off on the spot, and init is never tried
 * again in this process: each further attempt would build another client and
 * stack another set of process listeners. The user gets "restart required".
 */
let _restartRequired = false
/**
 * Machine-identifying names collected once at init — the OS account name and
 * the home-directory basename (these are usually the same string, but not
 * always: a renamed account keeps its original home-directory name on
 * macOS/Linux). Passed to every scrub call in addition to the generic path
 * patterns, since those patterns alone can't fully redact a name that
 * contains punctuation Claude Code's own project-folder encoding turns into
 * a '-' — see the comment on `knownNamePatterns` in sentry-scrub.ts.
 */
let _knownNames: string[] = []

function _computeKnownNames(): string[] {
  const names = new Set<string>()
  try {
    // os.userInfo() can throw (e.g. no matching entry in the system's user
    // database, seen in some sandboxed/CI environments) — don't let that
    // stop Sentry from initialising.
    const { username } = os.userInfo()
    if (username) names.add(username)
  } catch {
    // fall through — we still have the home-directory basename below
  }
  try {
    names.add(path.basename(os.homedir()))
  } catch {
    // defensive: os.homedir() failing shouldn't crash init either
  }
  return [...names]
}

/**
 * Read sentryEnabled from the preferences JSON file without electron-store.
 * Used to bootstrap Sentry before app.whenReady() fires (Sentry/Electron requirement).
 * Falls back to false (opt-out) on any read/parse error.
 */
function _readSentryEnabledSync(): boolean {
  try {
    const appData =
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : (process.env.APPDATA ?? path.join(os.homedir(), '.config'))
    const prefsPath = path.join(appData, 'ClaudeWatch', 'preferences.json')
    const raw = fs.readFileSync(prefsPath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed?.sentryEnabled === true
  } catch {
    return false
  }
}

/**
 * Ask the offline transport to retry its queue now. While reporting is off,
 * `shouldStore` below refuses to put a retried envelope back, so each retry
 * drops one stored report and schedules the next: the queue empties within
 * a few hundred milliseconds, without anything being sent.
 */
function _drainOfflineQueue(): void {
  try {
    const transport = Sentry.getClient()?.getTransport?.()
    if (!transport) return
    Promise.resolve(transport.flush()).catch(() => {})
  } catch (e) {
    // Switching reporting off must never fail; the send gate still holds.
    log.warn('Could not drain the crash report queue', e)
  }
}

/**
 * Consent gate for @sentry/electron's default transport. That transport is
 * @sentry/core's `makeOfflineTransport` with `flushAtStartup: true`
 * (@sentry/electron esm/main/transports/electron-offline-net.js); its retry
 * timer takes an envelope stored on disk (userData/sentry/queue) and passes
 * it straight to the network transport, so neither `beforeSend` nor the
 * client's `enabled` flag is consulted. `shouldSend` is checked before every
 * send, first attempts and retries alike (@sentry/core
 * build/esm/transports/offline.js `send`).
 *
 * Retention: a refused send is offered to `shouldStore`, and the SDK keeps the
 * envelope when it returns true. The SDK offers no call to clear the queue,
 * so turning reporting off drains it instead: `shouldStore` refuses, the
 * retried report is dropped, and the next one is retried straight away.
 * Reports queued while the user consented and waiting for a restart after a
 * runtime enable are kept (still unsent) for the next launch. If the app quits
 * before a drain finishes, what is left stays on disk and is never sent while
 * reporting is off: with reporting off at launch the SDK isn't started at all.
 */
const _transportOptions = {
  shouldSend: (): boolean => _enabled && !_restartRequired,
  shouldStore: (): boolean => {
    if (_enabled) return true
    _drainOfflineQueue()
    return false
  },
}

const EXCLUDED_INTEGRATIONS = new Set(['SentryMinidump', 'MainProcessSession'])

function _doInit(): void {
  if (_initialised || !DSN) return

  _knownNames = _computeKnownNames()

  Sentry.init({
    dsn: DSN,
    // Crash reports + user feedback only — no perf traces, no session replay.
    tracesSampleRate: 0,
    // No native minidumps (memory dumps) — JavaScript exceptions only. No
    // release-health sessions either: MainProcessSession sends a session
    // envelope (id, start, duration, status) at quit, which is usage
    // telemetry rather than a crash report. The only code that reports a
    // previous run's stored session (`sentry/session.json`) lives in the
    // minidump integrations, and SentryMinidump is dropped here too.
    integrations: (defaults) => defaults.filter((i) => !EXCLUDED_INTEGRATIONS.has(i.name)),
    beforeSend(event) {
      if (!_enabled) return null // gate: drop event when user has opted out
      // Strip home-directory paths (macOS, Linux and Windows) so filenames
      // and messages don't leak usernames.
      return scrubEvent(event, _knownNames)
    },
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb, _knownNames),
    transportOptions: _transportOptions,
  })

  // @sentry/core's captureFeedback only runs the client through `beforeSend`
  // for events with `event.type === undefined` — a feedback event has
  // `type: 'feedback'`, so it bypasses `beforeSend` (and its scrubEvent
  // call above) entirely. `beforeSendFeedback` is the SDK's dedicated
  // mutate-in-place hook for this event type: the callback's return value
  // is ignored, so scrubbing here means editing the object we're handed
  // rather than returning a new one — the one intentional exception to
  // "never mutate" in this module. Name and email are user-typed and sent
  // as typed, so only message/contexts/extra/tags are scrubbed.
  Sentry.getClient()?.on('beforeSendFeedback', (feedback) => {
    const ctx = feedback.contexts.feedback
    const { name, contact_email } = ctx
    feedback.contexts = scrubDeep(feedback.contexts, _knownNames)
    if (feedback.extra) feedback.extra = scrubDeep(feedback.extra, _knownNames)
    if (feedback.tags) feedback.tags = scrubDeep(feedback.tags, _knownNames)
    feedback.contexts.feedback.name = name
    feedback.contexts.feedback.contact_email = contact_email
  })

  _initialised = true
  log.info('Sentry initialised')
}

/**
 * Called synchronously before app.whenReady() — Sentry/Electron requires
 * initialization before the ready event fires. Reads sentryEnabled directly
 * from the preferences JSON without electron-store.
 */
export function initSentryEarly(): void {
  _enabled = _readSentryEnabledSync()
  if (!DSN || !_enabled) return
  _doInit()
}

/** Called once after preferences are fully loaded to sync the enabled state. */
export function initSentry(enabled: boolean): void {
  _enabled = enabled
  if (!DSN) {
    log.info('Sentry DSN not configured — disabled')
    return
  }
  if (!enabled) {
    log.info('Sentry opted out by user preference')
    return
  }
  _doInit()
}

/**
 * Stop whatever client the SDK has bound — the one `_doInit` finished, or one
 * a failed runtime init left behind. The SDK's own `enabled` flag is what its
 * transport checks before sending anything, including the session envelope
 * the session integration sends at quit.
 */
function _disableBoundClient(): void {
  const client = Sentry.getClient()
  if (client) client.getOptions().enabled = false
}

export interface SetSentryEnabledResult {
  /**
   * True when the caller asked to enable crash reports but the SDK is still
   * not initialised after the attempt — the renderer should tell the user a
   * restart is needed. Always false for the disable path (that always
   * applies immediately).
   */
  restartRequired: boolean
}

/** Called at runtime when the user toggles the preference. */
export function setSentryEnabled(enabled: boolean): SetSentryEnabledResult {
  _enabled = enabled

  if (enabled) {
    if (!_initialised && !_restartRequired) {
      try {
        _doInit()
      } catch (e) {
        // @sentry/electron's IPC transport must be wired up before the
        // Electron app's 'ready' event fires (it registers a custom protocol
        // scheme). Enabling from off happens at runtime, well after ready, so
        // Sentry.init() throws synchronously here every time — _initialised
        // stays false. Swallow it rather than letting it bubble up as an IPC
        // handler failure; the caller sees restartRequired instead.
        //
        // The client that init() had already created and bound is still
        // live, though (see `_restartRequired`). Nothing may be sent until
        // the restart the user is about to be asked for, so turn it off and
        // close it.
        _restartRequired = true
        const client = Sentry.getClient()
        if (client) {
          client.getOptions().enabled = false
          if (typeof client.close === 'function') {
            Promise.resolve(client.close(0)).catch(() => {})
          }
        }
        log.warn('Sentry could not be initialised at runtime — a restart is required', e)
      }
    }
    // If already initialised, flip the SDK's own enabled flag back on.
    if (_initialised) {
      const client = Sentry.getClient()
      if (client) client.getOptions().enabled = true
      log.info('Sentry enabled by user')
    }
    return { restartRequired: !_initialised }
  }

  // Use the SDK's own enabled flag so the transport stops sending immediately,
  // in addition to the beforeSend gate. Not gated on `_initialised`: a failed
  // runtime init leaves a bound client this module never marked initialised,
  // and it must be switched off too.
  _disableBoundClient()
  // Reports already queued on disk must not leave later either.
  _drainOfflineQueue()
  log.info('Sentry disabled by user')
  return { restartRequired: false }
}

export function captureException(err: unknown): void {
  if (!_enabled || !_initialised) return
  Sentry.captureException(err)
}

/**
 * Capture a managed (caught) exception from an IPC handler, skipping
 * IPC validation failures which are caller errors, not application bugs.
 */
export function captureHandlerException(err: unknown): void {
  if (err instanceof Error && err.message.startsWith('IPC validation failed')) return
  captureException(err)
}

export function captureMessage(message: string): void {
  if (!_enabled || !_initialised) return
  Sentry.captureMessage(scrubText(message, _knownNames))
}

export interface UserFeedback {
  name: string
  email: string
  message: string
}

/**
 * Hands the feedback to Sentry. Returns false when it was not sent — crash
 * reports are off, or they were switched on and the SDK only starts after a
 * restart — so the caller can say so instead of reporting success for a
 * message that went nowhere.
 */
export function captureUserFeedback(feedback: UserFeedback): boolean {
  if (!_enabled || !_initialised) return false
  Sentry.captureFeedback({
    // Name and email are user-typed and sent as typed — only the free-text
    // message can contain a stray path, so only it is scrubbed.
    name: feedback.name,
    email: feedback.email,
    message: scrubText(feedback.message, _knownNames),
  })
  log.info('User feedback submitted to Sentry')
  return true
}
