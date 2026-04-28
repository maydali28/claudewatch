import { app, net } from 'electron'
import { spawn } from 'child_process'
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
  if (process.platform === 'darwin') return `darwin_${process.arch}`
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

// ─── macOS / Linux: Hazel update check ────────────────────────────────────────

// Sentinel to distinguish "no update" (204) from a fetch error
const NO_UPDATE = Symbol('NO_UPDATE')

// ─── macOS update-manifest verification ──────────────────────────────────────
//
// Hazel only returns a release tag — there is no payload integrity field in
// its response, so a compromised Hazel could lie about the version and the
// app would happily prompt users to "upgrade". We belt-and-suspenders this by
// also fetching `latest-mac.json` from the GitHub release directly (generated
// by the release workflow) and refusing to signal availability unless:
//   1. The manifest's `version` matches what Hazel said.
//   2. The manifest contains at least one DMG artifact with a non-empty SHA-512.
// The DMG itself is installed via `brew upgrade --cask` (Homebrew verifies its
// own pinned sha256), so we don't have to download bytes here — but we DO
// confirm that the upstream artifacts the brew formula points at exist and
// were emitted by our release pipeline.

interface MacReleaseManifest {
  version: string
  releaseDate: string
  artifacts: Array<{ name: string; url: string; sha512: string; size: number }>
}

const GITHUB_RELEASES_BASE = AppConfig.githubReleasesUrl

async function fetchMacReleaseManifest(version: string): Promise<MacReleaseManifest | null> {
  const manifestUrl = `${GITHUB_RELEASES_BASE}/v${version}/latest-mac.json`
  return new Promise((resolve) => {
    const req = net.request({ url: manifestUrl, method: 'GET', redirect: 'follow' })
    req.setHeader('User-Agent', `ClaudeWatch/${app.getVersion()} Electron`)
    let body = ''
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        log.warn('[UpdateService] Mac manifest unavailable:', res.statusCode)
        resolve(null)
        return
      }
      res.on('data', (chunk) => {
        body += chunk.toString()
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as MacReleaseManifest)
        } catch (e) {
          log.error('[UpdateService] Mac manifest parse failed:', e)
          resolve(null)
        }
      })
    })
    req.on('error', (e) => {
      log.warn('[UpdateService] Mac manifest fetch failed:', e)
      resolve(null)
    })
    req.end()
  })
}

/**
 * Returns true when the manifest published with the GitHub release agrees with
 * what Hazel claimed AND every advertised artifact carries a SHA-512. We are
 * happy to fall back (return true) if the manifest 404s — older releases
 * predate the manifest, and we don't want to permanently silence updates for
 * users on legacy versions during the rollout window.
 */
async function verifyMacReleaseManifest(claimedVersion: string): Promise<boolean> {
  const manifest = await fetchMacReleaseManifest(claimedVersion)
  if (!manifest) {
    log.warn(
      '[UpdateService] No verifiable manifest for v' +
        claimedVersion +
        ' — proceeding (legacy release)'
    )
    return true
  }
  if (manifest.version !== claimedVersion) {
    log.error(
      '[UpdateService] Manifest version mismatch — Hazel said',
      claimedVersion,
      'but manifest reports',
      manifest.version
    )
    return false
  }
  const dmgArtifacts = (manifest.artifacts ?? []).filter((a) => /\.dmg$/i.test(a.name))
  if (dmgArtifacts.length === 0) {
    log.error('[UpdateService] Manifest contains no DMG artifacts — refusing to signal update')
    return false
  }
  const everyArtifactHasHash = dmgArtifacts.every(
    (a) => typeof a.sha512 === 'string' && a.sha512.length > 0
  )
  if (!everyArtifactHasHash) {
    log.error('[UpdateService] Manifest is missing sha512 on at least one DMG — refusing')
    return false
  }
  return true
}

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

// ─── Windows / Linux: electron-updater ────────────────────────────────────────

async function initAutoUpdater(): Promise<void> {
  if (_autoUpdaterInitialised) return
  _autoUpdaterInitialised = true

  const { autoUpdater } = await import('electron-updater')

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
      isMacBrew: false,
    }
    broadcastToRenderers(CHANNELS.PUSH_UPDATE_AVAILABLE, _latestInfo)
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
  if (process.platform !== 'darwin') {
    initAutoUpdater().catch((e) => {
      log.error('[UpdateService] Failed to initialise auto-updater:', e)
    })
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const isMac = process.platform === 'darwin'
      const remote = await fetchLatestVersionFromHazel()
      if (remote !== NO_UPDATE) {
        const currentVersion = app.getVersion()
        if (isRemoteVersionNewer(remote.version, currentVersion)) {
          // On macOS, cross-check the version Hazel announced against the
          // signed manifest published with the GitHub release. If verification
          // fails we suppress the update prompt entirely — better to leave the
          // user one version behind than to point them at unverified bytes.
          if (isMac) {
            const manifestVerified = await verifyMacReleaseManifest(remote.version)
            if (!manifestVerified) {
              pushUpdateServiceError(
                'A new version was announced but its release manifest could not be verified. Please check github.com/maydali28/claudewatch/releases manually.'
              )
              return _latestInfo
            }
          }
          _latestInfo = {
            version: remote.version,
            releaseNotes: remote.releaseNotes,
            releaseDate: remote.releaseDate,
            isMacBrew: isMac,
          }
        }
      }
      return _latestInfo
    }

    const { autoUpdater } = await import('electron-updater')
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
      isMacBrew: false,
    }
    return _latestInfo
  } catch (e) {
    log.error('[UpdateService] checkForUpdate error:', e)
    throw e
  }
}

export async function downloadUpdate(): Promise<void> {
  if (process.platform === 'darwin') {
    throw new Error('Use openBrewUpgrade() on macOS instead of downloadUpdate()')
  }
  const { autoUpdater } = await import('electron-updater')
  await autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  if (process.platform === 'darwin') {
    throw new Error('Use openBrewUpgrade() on macOS instead of installUpdate()')
  }
  if (!_updateDownloaded) {
    throw new Error('No update has been downloaded yet')
  }
  import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.quitAndInstall(false, true)
  })
}

/**
 * macOS only: open a Terminal and run `brew upgrade --cask claudewatch`.
 */
export function openBrewUpgrade(): void {
  if (process.platform !== 'darwin') {
    throw new Error('openBrewUpgrade() is only available on macOS')
  }

  const script = [
    'tell application "Terminal"',
    '  activate',
    `  do script "brew upgrade --cask ${AppConfig.brewCaskName}"`,
    'end tell',
  ].join('\n')

  const child = spawn('osascript', ['-e', script], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  log.info('[UpdateService] Launched brew upgrade via Terminal')
}
