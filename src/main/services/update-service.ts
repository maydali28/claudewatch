import { app, net } from 'electron'
// Static import on purpose: `await import('electron-updater')` in the CJS main
// bundle stays a real ESM dynamic import, and Node's named-export detection
// misses `autoUpdater` (it's a lazy getter on `exports`), yielding undefined.
import { autoUpdater } from 'electron-updater'
import logPkg from 'electron-log'
import semver from 'semver'
const log = logPkg
import { CHANNELS } from '@shared/ipc/channels'
import type { UpdateInfo } from '@shared/types/project'
import { broadcastToRenderers } from '@main/window-manager'

// ─── Constants ────────────────────────────────────────────────────────────────
import { AppConfig } from '@main/lib/app-config'

const RELEASES_BASE_URL: string = AppConfig.releaseServerUrl

function getHazelPlatform(): string | null {
  if (process.platform === 'linux') return 'deb'
  return null
}

// ─── State ────────────────────────────────────────────────────────────────────

let _latestInfo: UpdateInfo | null = null
let _updateDownloaded = false
let _autoUpdaterInitialised = false

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * True when `remoteVersion` is strictly newer than `currentVersion`.
 *
 * Uses the `semver` package (already in our dep tree) so pre-release tags like
 * `1.0.0-beta.1` compare correctly against `1.0.0` — naive split-by-dot
 * comparison incorrectly ranks the pre-release ahead. We also opt OUT of
 * pre-release matching by stripping pre-release suffixes from the remote tag
 * before comparing: stable users should never be auto-prompted to a beta even
 * if the upstream channel exposes one.
 */
function isRemoteVersionNewer(remoteVersion: string, currentVersion: string): boolean {
  const cleanedRemote = semver.clean(remoteVersion, { loose: true })
  const cleanedCurrent = semver.clean(currentVersion, { loose: true })
  if (!cleanedRemote || !cleanedCurrent) {
    log.warn('[UpdateService] Could not parse semver:', { remoteVersion, currentVersion })
    return false
  }
  // Reject pre-release tags from the update channel — see doc-comment.
  if (semver.prerelease(cleanedRemote)) {
    log.info('[UpdateService] Skipping pre-release update tag:', cleanedRemote)
    return false
  }
  return semver.gt(cleanedRemote, cleanedCurrent)
}

function pushUpdateServiceError(message: string): void {
  log.error('[UpdateService] health event:', message)
  broadcastToRenderers(CHANNELS.PUSH_UPDATE_SERVICE_ERROR, { message })
}

// ─── Linux: Hazel update check ────────────────────────────────────────────────

// Sentinel to distinguish "no update" (204) from a fetch error
const NO_UPDATE = Symbol('NO_UPDATE')

async function fetchLatestVersionFromHazel(): Promise<
  { version: string; releaseNotes?: string; releaseDate?: string } | typeof NO_UPDATE
> {
  if (!RELEASES_BASE_URL) {
    log.warn('[UpdateService] MAIN_VITE_RELEASE_SERVER_URL is not set — skipping update check')
    throw new Error(
      'The update server URL is not configured for this build. Updates cannot be checked automatically.'
    )
  }

  const hazelPlatform = getHazelPlatform()
  if (!hazelPlatform) throw new Error('Unsupported platform for update checks.')

  const currentVersion = app.getVersion()
  const url = `${RELEASES_BASE_URL}/update/${hazelPlatform}/${currentVersion}`
  log.info('[UpdateService] Checking Hazel:', url)

  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' })
    req.setHeader('User-Agent', `ClaudeWatch/${currentVersion} Electron`)
    let body = ''

    req.on('response', (res) => {
      if (res.statusCode === 204) {
        resolve(NO_UPDATE)
        return
      }
      if (res.statusCode !== 200) {
        log.warn('[UpdateService] Unexpected status from Hazel:', res.statusCode)
        reject(
          new Error(
            `Unable to reach the update server (HTTP ${res.statusCode}). Please check your internet connection or visit github.com/maydali28/claudewatch/releases.`
          )
        )
        return
      }
      res.on('data', (chunk) => {
        body += chunk.toString()
      })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { name?: string; notes?: string; pub_date?: string }
          const tagName = parsed.name
          if (typeof tagName !== 'string') {
            log.warn('[UpdateService] Malformed response from Hazel')
            reject(new Error('Received an unexpected response from the update server.'))
            return
          }
          resolve({
            version: tagName.replace(/^v/, ''),
            releaseNotes: parsed.notes,
            releaseDate: parsed.pub_date,
          })
        } catch (e) {
          log.error('[UpdateService] Failed to parse Hazel response:', e)
          reject(new Error('Failed to parse the update server response.'))
        }
      })
    })

    req.on('error', (e) => {
      log.error('[UpdateService] Network error checking for updates:', e)
      reject(
        new Error(
          'Unable to reach the update server. Please check your internet connection or visit github.com/maydali28/claudewatch/releases.'
        )
      )
    })

    req.end()
  })
}

// ─── macOS / Windows / Linux: electron-updater ────────────────────────────────

function initAutoUpdater(): void {
  if (_autoUpdaterInitialised) return
  _autoUpdaterInitialised = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (!RELEASES_BASE_URL) {
    log.warn('[UpdateService] MAIN_VITE_RELEASE_SERVER_URL not set — auto-updater disabled')
    pushUpdateServiceError(
      'The update server URL is not configured. Auto-updates are disabled for this build.'
    )
    return
  }

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: RELEASES_BASE_URL,
    useMultipleRangeRequest: false,
  })

  autoUpdater.on('update-available', (info) => {
    _latestInfo = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate ? String(info.releaseDate) : undefined,
    }
    broadcastToRenderers(CHANNELS.PUSH_UPDATE_AVAILABLE, _latestInfo)
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcastToRenderers(CHANNELS.PUSH_UPDATE_DOWNLOAD_PROGRESS, {
      percent: progress.percent,
    })
  })

  autoUpdater.on('update-downloaded', () => {
    _updateDownloaded = true
  })

  autoUpdater.on('error', (err) => {
    log.error('[UpdateService] electron-updater error:', err)
    pushUpdateServiceError(
      'An error occurred while checking for updates. Please try again later or visit github.com/maydali28/claudewatch/releases.'
    )
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initUpdateService(): void {
  try {
    initAutoUpdater()
  } catch (e) {
    log.error('[UpdateService] Failed to initialise auto-updater:', e)
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    // Linux still polls Hazel directly for the latest version — the deb/rpm
    // packages aren't served through electron-updater's generic feed.
    if (process.platform === 'linux') {
      const remote = await fetchLatestVersionFromHazel()
      if (remote !== NO_UPDATE) {
        const currentVersion = app.getVersion()
        if (isRemoteVersionNewer(remote.version, currentVersion)) {
          _latestInfo = {
            version: remote.version,
            releaseNotes: remote.releaseNotes,
            releaseDate: remote.releaseDate,
          }
        }
      }
      return _latestInfo
    }

    // macOS (signed + notarized) and Windows update in-app via electron-updater.
    const result = await autoUpdater.checkForUpdates()
    if (!result) return null

    _latestInfo = {
      version: result.updateInfo.version,
      releaseNotes:
        typeof result.updateInfo.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : undefined,
      releaseDate: result.updateInfo.releaseDate
        ? String(result.updateInfo.releaseDate)
        : undefined,
    }
    return _latestInfo
  } catch (e) {
    log.error('[UpdateService] checkForUpdate error:', e)
    throw e
  }
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  if (!_updateDownloaded) {
    throw new Error('No update has been downloaded yet')
  }
  autoUpdater.quitAndInstall(false, true)
}
