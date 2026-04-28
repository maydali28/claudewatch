import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as Sentry from '@sentry/electron/main'
import { createLogger } from '@main/lib/logger'
import { AppConfig } from '@main/lib/app-config'

const log = createLogger('Sentry')

const DSN = AppConfig.sentryDsn || undefined

let _initialised = false
let _enabled = false

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

function _doInit(): void {
  if (_initialised || !DSN) return

  Sentry.init({
    dsn: DSN,
    // Crash reports + user feedback only — no perf traces, no session replay.
    tracesSampleRate: 0,
    beforeSend(event) {
      if (!_enabled) return null // gate: drop event when user has opted out
      // Strip home-directory paths so filenames don't leak usernames.
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) {
            ex.value = ex.value.replace(/\/Users\/[^/]+/g, '/Users/[user]')
          }
          if (ex.stacktrace?.frames) {
            for (const frame of ex.stacktrace.frames) {
              if (frame.filename) {
                frame.filename = frame.filename.replace(/\/Users\/[^/]+/g, '/Users/[user]')
              }
            }
          }
        }
      }
      return event
    },
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

/** Called at runtime when the user toggles the preference. */
export function setSentryEnabled(enabled: boolean): void {
  _enabled = enabled

  if (enabled) {
    _doInit() // idempotent — safe to call even if already initialised
    // If already initialised, flip the SDK's own enabled flag back on.
    if (_initialised) {
      const client = Sentry.getClient()
      if (client) client.getOptions().enabled = true
    }
    log.info('Sentry enabled by user')
  } else {
    // Use the SDK's own enabled flag so the transport stops sending immediately,
    // in addition to the beforeSend gate.
    if (_initialised) {
      const client = Sentry.getClient()
      if (client) client.getOptions().enabled = false
    }
    log.info('Sentry disabled by user')
  }
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
  Sentry.captureMessage(message)
}

export interface UserFeedback {
  name: string
  email: string
  message: string
}

export function captureUserFeedback(feedback: UserFeedback): void {
  if (!_enabled || !_initialised) return
  Sentry.captureFeedback({
    name: feedback.name,
    email: feedback.email,
    message: feedback.message,
  })
  log.info('User feedback submitted to Sentry')
}
