/**
 * Whether this platform can download and install an update from inside the app.
 *
 * macOS and Windows go through electron-updater, which stages the download and
 * hands off to a native installer (Squirrel.Mac / NSIS). Linux does not:
 * ClaudeWatch ships as a distro package, the update check is a plain poll
 * against the release server, and electron-updater is never given a pending
 * update — so the "Download" button the Linux update window and About panel
 * offered could only ever fail, with electron-updater's own "Please check
 * update first". Those surfaces point at the package manager instead.
 *
 * Kept as a pure function so both surfaces make the same decision and it can
 * be tested without a renderer.
 */
export function canInstallInApp(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/** The command a Linux user runs to update the installed package. */
export const MANUAL_UPDATE_COMMAND = 'sudo apt upgrade claudewatch'
