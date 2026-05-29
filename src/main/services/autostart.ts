import { app } from 'electron'
import path from 'path'
import { promises as fs } from 'fs'
import os from 'os'
import { createLogger } from '@main/lib/logger'

const log = createLogger('Autostart')

/**
 * Register or unregister the app to launch at user login.
 *
 * Per-platform behaviour:
 * - macOS: app.setLoginItemSettings with openAsHidden + explicit path
 * - Windows: app.setLoginItemSettings with Squirrel Update.exe --processStart args
 * - Linux: write/delete ~/.config/autostart/claudewatch.desktop (XDG spec)
 *
 * In unpacked dev builds (!app.isPackaged) this is a no-op — registering the
 * unpacked Electron runtime leaves a stale entry that breaks after the next
 * `pnpm install` reshuffles node_modules.
 */
export async function setAutostart(enabled: boolean): Promise<void> {
  if (!app.isPackaged) {
    log.warn('Autostart skipped — running unpacked dev build')
    return
  }

  if (process.platform === 'darwin') {
    setMacAutostart(enabled)
    return
  }

  if (process.platform === 'win32') {
    setWindowsAutostart(enabled)
    return
  }

  if (process.platform === 'linux') {
    await setLinuxAutostart(enabled)
    return
  }
}

function setMacAutostart(enabled: boolean): void {
  // macOS only honours `openAtLogin` here. `openAsHidden` is deprecated and a
  // no-op on macOS 13+; `path` is Windows-only. The Dock-flash that
  // `openAsHidden` used to suppress is already prevented by the early
  // `app.dock?.hide()` call in main/index.ts.
  app.setLoginItemSettings({ openAtLogin: enabled })
}

function setWindowsAutostart(enabled: boolean): void {
  // Squirrel installs the app under `<root>/app-x.y.z/<exe>` and writes a
  // stub launcher one directory up at `<root>/<exe>` that forwards to the
  // latest installed version. Point the autostart entry at the stub so it
  // survives every Squirrel update — pinning to process.execPath would
  // break the next time the version directory changes.
  //
  // path.win32 is used explicitly so the path arithmetic uses Windows
  // separators regardless of the host OS (matters in tests run on POSIX).
  const appFolder = path.win32.dirname(process.execPath)
  const exeName = path.win32.basename(process.execPath)
  const stubLauncher = path.win32.resolve(appFolder, '..', exeName)

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: stubLauncher,
    args: [],
  })
}

const LINUX_AUTOSTART_DIR = '.config/autostart'
const LINUX_DESKTOP_FILE = 'claudewatch.desktop'

async function setLinuxAutostart(enabled: boolean): Promise<void> {
  const autostartDir = path.join(os.homedir(), LINUX_AUTOSTART_DIR)
  const desktopFile = path.join(autostartDir, LINUX_DESKTOP_FILE)

  if (!enabled) {
    try {
      await fs.unlink(desktopFile)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    return
  }

  // NOTE: app.getPath('exe') returns the AppImage mount path on AppImage
  // installs, which disappears after the AppImage exits. Not relevant for
  // the current .deb/.rpm shipping formats but worth knowing if AppImage
  // support is added — the .desktop Exec= line needs to point at the
  // user-visible install location, not the runtime mount.
  const execPath = app.getPath('exe')
  const desktopEntry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ClaudeWatch',
    `Exec=${execPath} --hidden`,
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=false',
    'Hidden=false',
    '',
  ].join('\n')

  await fs.mkdir(autostartDir, { recursive: true })
  await fs.writeFile(desktopFile, desktopEntry, 'utf8')
}
