import logPkg from 'electron-log'

const log = logPkg

// One-shot initialisation. Importing this module is enough — `index.ts` does
// not need to call `log.initialize()` separately. Idempotent (electron-log's
// initialize is safe to invoke once at module load), but we still guard
// against re-running in case the module is imported in unusual contexts.
let initialised = false
function initOnce(): void {
  if (initialised) return
  initialised = true
  log.initialize()
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB per log file
}
initOnce()

export interface ScopedLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export function createLogger(scope: string): ScopedLogger {
  const prefix = `[${scope}]`
  return {
    info: (...args: unknown[]) => log.info(prefix, ...args),
    warn: (...args: unknown[]) => log.warn(prefix, ...args),
    error: (...args: unknown[]) => log.error(prefix, ...args),
    debug: (...args: unknown[]) => log.debug(prefix, ...args),
  }
}

/**
 * Root logger used by main entry-point bootstrap code that doesn't have a
 * meaningful scope. Prefer `createLogger('Subsystem')` for service code so
 * grep-by-prefix in log files actually narrows things down.
 */
export const rootLogger: ScopedLogger = createLogger('Main')
