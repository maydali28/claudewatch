// Handles the lifecycle hooks Squirrel.Windows runs the app with.
//
// Electron executables are "Squirrel-aware", so Setup.exe does not create
// shortcuts or wait politely on its own: it launches the app with
// `--squirrel-install`, `--squirrel-updated`, `--squirrel-uninstall` or
// `--squirrel-obsolete` and waits for that process to exit. An app that
// ignores these flags boots fully (tray, windows, watchers) inside the hook,
// holds the installer splash open until Squirrel times out, and never gets a
// Start Menu or desktop shortcut.
//
// Each hook does its one job through Update.exe and quits. `--squirrel-firstrun`
// is the normal post-install launch and is left to boot the app.
//
// Kept dependency-free of `electron` so this file stays unit-testable without
// mocking it — see update-quit.ts for the same pattern.

import path from 'path'

// Squirrel kills a hook after ~15s. Quit well before that if Update.exe hangs.
const HOOK_EXIT_DEADLINE_MS = 5_000

interface SquirrelEventDeps {
  platform: NodeJS.Platform
  argv: string[]
  execPath: string
  spawn: (
    command: string,
    args: string[]
  ) => { on(event: 'close' | 'error', fn: () => void): unknown }
  quit: () => void
  exit: (code: number) => void
  // Clears the autostart entry on uninstall, or Windows keeps launching a
  // stub launcher that no longer exists.
  disableAutostart: () => void
  log: { info: (m: string) => void; warn: (m: string) => void }
}

/**
 * Runs the Squirrel hook named in argv, if any. Returns true when the process
 * is a hook invocation and must not boot the app.
 */
export function handleSquirrelEvent(deps: SquirrelEventDeps): boolean {
  if (deps.platform !== 'win32') return false

  const event = deps.argv[1]
  if (!event?.startsWith('--squirrel-') || event === '--squirrel-firstrun') return false

  // Layout: <root>/app-x.y.z/<exe>, with Update.exe and the stub launcher in
  // <root>. path.win32 keeps Windows separators even when tests run on POSIX.
  const exeName = path.win32.basename(deps.execPath)
  const updateExe = path.win32.resolve(path.win32.dirname(deps.execPath), '..', 'Update.exe')

  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    deps.quit()
  }

  const runUpdate = (args: string[]): void => {
    deps.log.info(`Squirrel ${event}: Update.exe ${args.join(' ')}`)
    try {
      const child = deps.spawn(updateExe, args)
      child.on('close', finish)
      child.on('error', () => {
        deps.log.warn(`Squirrel ${event}: Update.exe failed to start`)
        finish()
      })
    } catch {
      deps.log.warn(`Squirrel ${event}: Update.exe failed to start`)
      finish()
    }
    setTimeout(() => deps.exit(0), HOOK_EXIT_DEADLINE_MS).unref?.()
  }

  switch (event) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdate([`--createShortcut=${exeName}`])
      return true
    case '--squirrel-uninstall':
      try {
        deps.disableAutostart()
      } catch {
        deps.log.warn('Squirrel --squirrel-uninstall: could not clear autostart')
      }
      runUpdate([`--removeShortcut=${exeName}`])
      return true
    case '--squirrel-obsolete':
      // An older version being replaced by an update. Nothing to clean up.
      finish()
      return true
    default:
      // Unknown future hook: exit rather than boot inside the installer.
      finish()
      return true
  }
}
