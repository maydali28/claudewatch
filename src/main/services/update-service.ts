import { app, net } from 'electron'
// Static import on purpose: `await import('electron-updater')` in the CJS main
// bundle stays a real ESM dynamic import, and Node's named-export detection
// misses `autoUpdater` (it's a lazy getter on `exports`), yielding undefined.
import { autoUpdater } from 'electron-updater'
import logPkg from 'electron-log'
import semver from 'semver'
import * as fs from 'fs'
import * as path from 'path'
const log = logPkg
import { CHANNELS } from '@shared/ipc/channels'
import type { UpdateInfo, UpdatePhase, UpdateServiceError } from '@shared/types/project'
import { broadcastToRenderers, createOrShowUpdateWindow } from '@main/window-manager'
import { disarmUpdateQuit } from '@main/lib/update-quit'

// ─── Constants ────────────────────────────────────────────────────────────────
import { AppConfig } from '@main/lib/app-config'

const RELEASES_BASE_URL: string = AppConfig.releaseServerUrl

function getHazelPlatform(): string | null {
  if (process.platform === 'linux') return 'deb'
  return null
}

/**
 * Owner and repo of the GitHub repository that hosts our releases, derived
 * from the configured releases URL.
 *
 * This exists because the two update mechanisms need two different endpoints,
 * and conflating them broke updates in 1.2.0. `MAIN_VITE_RELEASE_SERVER_URL`
 * points at a Hazel deployment, which answers `/update/:platform/:version` and
 * serves no static files. electron-updater instead wants `latest-mac.yml` /
 * `latest.yml`, which `release.yml` publishes as GitHub Release assets. Asking
 * Hazel for `latest-mac.yml` returns 404, so every macOS and Windows update
 * check failed.
 *
 * Deriving owner/repo here and using electron-updater's `github` provider ties
 * the feed to the same place the release workflow publishes, so the two cannot
 * drift apart again. Pointing a `generic` feed at a hand-written GitHub URL
 * would reintroduce exactly that risk.
 */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const match = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)/i.exec(url.trim())
  if (!match) return null
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') }
}

// ─── State ────────────────────────────────────────────────────────────────────

let _latestInfo: UpdateInfo | null = null
let _updateDownloaded = false
let _autoUpdaterInitialised = false
let _phase: UpdatePhase = 'idle'
let _installHint: string | undefined

export function getUpdatePhase(): UpdatePhase {
  return _phase
}

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

const LOOKS_LIKE_HTML = /<\/?(?:h[1-6]|ul|ol|li|p|br|strong|b|em|i|code|pre|a|div)\b[^>]*>/i

function decodeEntities(text: string): string {
  // &amp; is decoded last so "&amp;lt;" does not become "<".
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0?39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

/**
 * Remove any remaining tags by scanning, rather than by regex replacement.
 *
 * A strip of the form `/<[^>]*>/g` is incomplete in two ways, and CodeQL
 * flagged it as such (high severity, "incomplete multi-character
 * sanitization"). It needs a closing ">", so `<script src=x` survived a pass
 * untouched; and removing one match can splice its neighbours into another.
 * Repeating the replacement until it stabilises fixes the second problem but
 * not the first, and is still a regex sanitizer.
 *
 * A single left-to-right scan has neither problem: an unterminated "<" simply
 * consumes the rest of the string, and there is nothing to splice because
 * nothing is removed from a buffer — text outside tags is copied out instead.
 *
 * Treating every bare "<" as a tag opener is correct for the input this gets.
 * A literal less-than in an Atom feed arrives as "&lt;", which `decodeEntities`
 * restores afterwards, so prose like "a &lt; b" is preserved.
 */
function stripTags(input: string): string {
  let out = ''
  let inTag = false
  for (const ch of input) {
    if (ch === '<') {
      inTag = true
      continue
    }
    if (ch === '>' && inTag) {
      inTag = false
      continue
    }
    if (!inTag) out += ch
  }
  return out
}

/**
 * Convert HTML release notes back to markdown.
 *
 * electron-updater's GitHub provider takes release notes from the releases
 * Atom feed, whose content is HTML — not the markdown we wrote into
 * CHANGELOG.md. The update window renders notes with react-markdown and
 * deliberately does not enable raw HTML, so from 1.2.1 the tags were shown
 * literally:
 *
 *   <h3>Bug Fixes</h3> <ul> <li><strong>deps:</strong> clear the 12 tar …
 *
 * Converting the small subset the feed emits is preferable to rendering
 * release-note HTML directly, which would mean turning on raw HTML in the
 * markdown renderer for text fetched over the network.
 *
 * Input that is not HTML — the plain text Hazel returns on Linux — is passed
 * through untouched.
 */
export function htmlReleaseNotesToMarkdown(input: string): string {
  if (!LOOKS_LIKE_HTML.test(input)) return input.trim()

  let out = input
  // Inline elements first, so their text survives the generic tag strip below.
  out = out.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, text: string) => `[${text.trim()}](${href})`
  )
  out = out.replace(
    /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _tag: string, text: string) => `**${text.trim()}**`
  )
  out = out.replace(
    /<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _tag: string, text: string) => `*${text.trim()}*`
  )
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, text: string) => `\`${text.trim()}\``)
  // Block elements.
  out = out.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, level: string, text: string) => `\n\n${'#'.repeat(Number(level))} ${text.trim()}\n\n`
  )
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, text: string) => `\n- ${text.trim()}`)
  out = out.replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n\n')
  out = out.replace(/<\/p>/gi, '\n\n').replace(/<p\b[^>]*>/gi, '')
  out = out.replace(/<br\s*\/?>/gi, '\n')

  out = stripTags(out)

  return decodeEntities(out)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function pushUpdateServiceError(error: UpdateServiceError): void {
  log.error('[UpdateService] health event:', error)
  broadcastToRenderers(CHANNELS.PUSH_UPDATE_SERVICE_ERROR, error)
}

function errorForPhase(err: unknown): UpdateServiceError {
  const message = err instanceof Error ? err.message : String(err)
  switch (_phase) {
    case 'installing':
      return {
        phase: 'install',
        message: `The update could not be installed: ${message}`,
        hint: _installHint,
      }
    case 'downloading':
      return { phase: 'download', message: `The update could not be downloaded: ${message}` }
    default:
      return { phase: 'check', message: `Could not check for updates: ${message}` }
  }
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

  // Note this reads the GitHub releases URL, not the Hazel one: Hazel only
  // backs the Linux path below and serves no static manifests.
  const repo = parseGithubRepo(AppConfig.githubReleasesUrl)
  if (!repo) {
    log.warn(
      '[UpdateService] MAIN_VITE_GITHUB_RELEASES_URL is missing or not a github.com URL — auto-updater disabled'
    )
    pushUpdateServiceError({
      phase: 'check',
      message: 'The update source is not configured for this build. Auto-updates are disabled.',
    })
    return
  }

  log.info('[UpdateService] Update feed: github %s/%s', repo.owner, repo.repo)
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: repo.owner,
    repo: repo.repo,
  })

  autoUpdater.on('update-available', (info) => {
    _latestInfo = {
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string'
          ? htmlReleaseNotesToMarkdown(info.releaseNotes)
          : undefined,
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
    _phase = 'downloaded'
  })

  autoUpdater.on('error', (err) => {
    log.error('[UpdateService] electron-updater error:', err)
    const report = errorForPhase(err)
    const wasInstalling = _phase === 'installing'
    if (wasInstalling) {
      // A cancelled or failed install means ShipIt/Squirrel never quit the app
      // for us — disarm the quit that `armUpdateQuit()` scheduled so the app
      // keeps running instead of quitting a few seconds from now with nothing
      // left to install.
      disarmUpdateQuit()
      // Ruling 1: a failed or cancelled install invalidates the staged update.
      _updateDownloaded = false
    }
    _phase = 'idle'
    pushUpdateServiceError(report)
    if (wasInstalling) {
      // A cancelled password prompt still has every window on screen: the
      // native updater raises that panel inside `quitAndInstall`, before
      // `before-quit-for-update` and before anything is closed. But once the
      // handoff has begun the windows are being torn down, so a failure from
      // there on may leave the broadcast above with no renderer to reach.
      // Reopening the update window covers that case and is a no-op focus in
      // the common one — see disarmUpdateQuit's onUpdateQuitDisarmed hook for
      // the matching dashboard-window recovery.
      createOrShowUpdateWindow(_latestInfo, undefined, report)
    }
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
  // The tray popover runs a check every time it opens. If a download or an
  // install is already under way, do not steal the phase out from under it —
  // an 'error' event mid-check must still be attributed to that download/
  // install, not reported as a plain check failure.
  const trackPhase = _phase !== 'downloading' && _phase !== 'installing'
  if (trackPhase) _phase = 'checking'
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

    // `checkForUpdates()` resolves with whatever the feed's newest release is,
    // whether or not it is newer than what is running. Without this guard the
    // window offered an "update" to the version already installed, and then
    // Download failed with electron-updater's "Please check update first" —
    // its own state correctly held no pending update. The Linux branch above
    // has always compared; this branch did not.
    const currentVersion = app.getVersion()
    if (!isRemoteVersionNewer(result.updateInfo.version, currentVersion)) {
      log.info(
        '[UpdateService] No update: remote %s is not newer than %s',
        result.updateInfo.version,
        currentVersion
      )
      _latestInfo = null
      return null
    }

    _latestInfo = {
      version: result.updateInfo.version,
      releaseNotes:
        typeof result.updateInfo.releaseNotes === 'string'
          ? htmlReleaseNotesToMarkdown(result.updateInfo.releaseNotes)
          : undefined,
      releaseDate: result.updateInfo.releaseDate
        ? String(result.updateInfo.releaseDate)
        : undefined,
    }
    return _latestInfo
  } catch (e) {
    log.error('[UpdateService] checkForUpdate error:', e)
    throw e
  } finally {
    // Only clear the phase this call set — an 'error' event handled during
    // the check (or a download/install this check deliberately left alone)
    // may already have moved it on.
    if (_phase === 'checking') _phase = 'idle'
  }
}

export async function downloadUpdate(): Promise<void> {
  // A second surface (the reopened update window, or the tray popover) can
  // still be offering "Download" while an install started elsewhere is in
  // flight. Letting it through flipped the phase to 'downloading', which made
  // electron-updater close the local proxy Squirrel is reading and swap the
  // native updater underneath it; the failure that followed was then reported
  // as a download error, so neither `disarmUpdateQuit()` nor the staged-
  // download reset ran and the installing surface stayed on "Installing…".
  if (_phase === 'installing') throw new Error('An install is already in progress')
  _phase = 'downloading'
  try {
    await autoUpdater.downloadUpdate()
    if (_phase === 'downloading') _phase = 'downloaded'
  } catch (e) {
    if (_phase === 'downloading') _phase = 'idle'
    throw e
  }
}

export async function installUpdate(): Promise<void> {
  if (_phase === 'installing') throw new Error('An install is already in progress')
  if (!_updateDownloaded) throw new Error('No update has been downloaded yet')
  // Claim the phase BEFORE the first await. Two near-simultaneous IPC calls
  // (the tray popover and the update window both show "Install & Restart")
  // otherwise both clear the guard while the first one is still awaiting the
  // writability probe, and electron-updater is asked to hand off twice.
  _phase = 'installing'
  _installHint = await bundleWritabilityHint()
  autoUpdater.quitAndInstall(false, true)
}

/**
 * Check for an update and open (or focus) the update window with the result.
 *
 * Shared by the tray popover's "Show Update" IPC handler and the tray menu's
 * "Check for Updates" item, which previously sent a dead
 * `'push:check-update-request'` channel that nothing listened for — the menu
 * item did nothing.
 */
export async function showUpdateWindowAfterCheck(): Promise<void> {
  try {
    const info = await checkForUpdate()
    createOrShowUpdateWindow(info ?? null)
  } catch (e) {
    createOrShowUpdateWindow(null, e instanceof Error ? e.message : String(e))
  }
}

async function isWritable(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * macOS only: explain, before the fact, why ShipIt is about to raise a
 * password panel.
 *
 * Squirrel.Mac installs by writing the new bundle as a sibling of the current
 * one and swapping the two, so it needs write access to the bundle *and* to
 * the directory containing it. Checking only the bundle missed the ordinary
 * non-admin case — a user-owned app sitting in a root-owned /Applications —
 * where the app is perfectly writable and the prompt still appears, and where
 * the chown advice would have changed nothing.
 *
 * The dependencies are injected so both branches (and the non-darwin
 * short-circuit) are testable without touching the filesystem.
 */
export async function bundleWritabilityHint(
  options: {
    platform?: NodeJS.Platform
    bundlePath?: string
    canWrite?: (target: string) => Promise<boolean>
  } = {}
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return undefined
  // <App>.app/Contents/MacOS/ClaudeWatch → <App>.app
  const bundle = options.bundlePath ?? path.resolve(process.execPath, '..', '..', '..')
  const parent = path.dirname(bundle)
  const canWrite = options.canWrite ?? isWritable

  if (!(await canWrite(bundle))) {
    log.warn('[UpdateService] app bundle is not writable by the current user:', bundle)
    return `macOS asks for a password because ${bundle} is not writable by your user. You can usually avoid it with: sudo chown -R "$(id -un)" "${bundle}"`
  }
  if (!(await canWrite(parent))) {
    log.warn('[UpdateService] the folder holding the app is not writable:', parent)
    return `macOS will ask for an administrator password because the folder holding the app (${parent}) is not writable by your user.`
  }
  return undefined
}
