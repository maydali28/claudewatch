import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { SessionSummary } from '@shared/types/session'
import { CHANNELS } from '@shared/ipc/channels'
import { FILE_WATCHER_DEBOUNCE_MS } from '@shared/constants/tuning'

// electron-log's initialize() needs an Electron main-process runtime; under
// vitest's `forks` pool `isMainThread` reads true even outside Electron, so
// the real logger throws at import time — see autostart.test.ts:22-27.
vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// `@main/store/preferences` and `@main/ipc/sessions.handlers` both pull in
// Electron (`app` / `ipcMain`) transitively, plus (for sessions.handlers) the
// whole scan-cache/session-search chain. Mocking them keeps this file
// exercising only FileWatcher's own event handling and debounce logic — the
// same isolation approach scan-cache.test.ts uses for its own dependencies.
const mockPreferencesGet = vi.fn()
vi.mock('@main/store/preferences', () => ({
  Preferences: {
    get: () => mockPreferencesGet(),
    set: vi.fn(),
  },
}))

const mockPatchCachedSessionSummary = vi.fn()
const mockRemoveCachedSession = vi.fn()
const mockPeekCachedSessionsForProject = vi.fn((_projectId: string) => [] as SessionSummary[])
vi.mock('@main/ipc/sessions.handlers', () => ({
  patchCachedSessionSummary: (summary: SessionSummary) => mockPatchCachedSessionSummary(summary),
  removeCachedSession: (projectId: string, sessionId: string) =>
    mockRemoveCachedSession(projectId, sessionId),
  peekCachedSessionsForProject: (projectId: string) => mockPeekCachedSessionsForProject(projectId),
}))

const mockInvalidateCachedSummary = vi.fn()
vi.mock('./metadata-cache', () => ({
  invalidateCachedSummary: (...args: unknown[]) => mockInvalidateCachedSummary(...args),
}))

const mockParseSession = vi.fn()
vi.mock('./accounting/worker-client', () => ({
  accountingWorker: {
    parseSession: (...args: unknown[]) => mockParseSession(...args),
  },
}))

const mockScanFileDelta = vi.fn()
vi.mock('./secret-scanner', () => ({
  scanFileDelta: (...args: unknown[]) => mockScanFileDelta(...args),
}))

/**
 * Minimal stand-in for chokidar's FSWatcher: an event emitter tests fire
 * directly. This keeps the tests off the real filesystem watcher (slow and
 * flaky under CI, since it depends on OS-level fs-event delivery) while still
 * exercising FileWatcher's actual event wiring, debounce, and existence
 * checks against real files on disk.
 */
class FakeChokidarWatcher {
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  on(event: string, handler: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
    return this
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args)
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

let watchedInstances: FakeChokidarWatcher[] = []
vi.mock('chokidar', () => ({
  default: {
    watch: () => {
      const instance = new FakeChokidarWatcher()
      watchedInstances.push(instance)
      return instance
    },
  },
}))

import { FileWatcher } from './file-watcher'

function fakeSummary(id: string, projectId: string): SessionSummary {
  return { id, projectId } as unknown as SessionSummary
}

const BASE_PREFS = {
  pricingProvider: 'anthropic',
  pricingOverrides: {},
  secretScanEnabled: false,
  redactionLevel: 'none',
  launchAtLogin: false,
  trayTipDismissed: false,
  theme: 'system',
  sidebarWidth: 280,
  alertedSecrets: [],
  sentryEnabled: false,
}

describe('FileWatcher — deletions', () => {
  let claudeDir: string
  const projectId = 'proj'
  const sessionId = 'sess-1'
  let projectDir: string
  let parentPath: string
  let subagentsDir: string
  let childPath: string

  beforeEach(() => {
    vi.useFakeTimers()
    watchedInstances = []
    mockPreferencesGet.mockReturnValue({ ...BASE_PREFS })
    mockParseSession.mockReset().mockResolvedValue(fakeSummary(sessionId, projectId))
    mockPatchCachedSessionSummary.mockReset()
    mockRemoveCachedSession.mockReset()
    mockPeekCachedSessionsForProject.mockReset().mockReturnValue([])
    mockInvalidateCachedSummary.mockReset()

    // Real files on disk (not mocked `fs`) so `fs.existsSync` inside
    // `processSessionFileChange` sees genuine deletions — the whole point of
    // these tests is that a vanished path is handled sensibly.
    claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-'))
    projectDir = path.join(claudeDir, 'projects', projectId)
    parentPath = path.join(projectDir, `${sessionId}.jsonl`)
    subagentsDir = path.join(projectDir, sessionId, 'subagents')
    childPath = path.join(subagentsDir, 'agent-1.jsonl')

    fs.mkdirSync(subagentsDir, { recursive: true })
    fs.writeFileSync(parentPath, '')
    fs.writeFileSync(childPath, '')
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(claudeDir, { recursive: true, force: true })
  })

  function makeWatcher(): {
    broadcast: ReturnType<typeof vi.fn>
    projectsWatcher: FakeChokidarWatcher
  } {
    const broadcast = vi.fn()
    const getMainWindow = vi.fn(() => null)
    const watcher = new FileWatcher(claudeDir, { broadcast, getMainWindow })
    watcher.start()
    // `start()` creates the projects watcher first, the settings watcher second.
    const [projectsWatcher] = watchedInstances
    return { broadcast, projectsWatcher }
  }

  it('re-parses the parent when a subagent transcript is deleted', async () => {
    const { projectsWatcher } = makeWatcher()

    fs.rmSync(childPath)
    projectsWatcher.emit('unlink', childPath)
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_DEBOUNCE_MS)

    // The child's own path is never parsed — only the parent, which
    // discovers its (now absent) subagents itself. No special-casing of the
    // deletion is needed: the rollup simply stops finding it.
    expect(mockParseSession).toHaveBeenCalledWith(
      parentPath,
      sessionId,
      projectId,
      expect.anything()
    )
    expect(mockInvalidateCachedSummary).not.toHaveBeenCalled()
    expect(mockRemoveCachedSession).not.toHaveBeenCalled()
  })

  it('invalidates the cached summary and broadcasts a removal when the parent transcript is deleted', async () => {
    const { projectsWatcher, broadcast } = makeWatcher()

    fs.rmSync(parentPath)
    projectsWatcher.emit('unlink', parentPath)
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_DEBOUNCE_MS)

    expect(mockInvalidateCachedSummary).toHaveBeenCalledWith(parentPath)
    expect(mockRemoveCachedSession).toHaveBeenCalledWith(projectId, sessionId)
    expect(broadcast).toHaveBeenCalledWith(CHANNELS.PUSH_SESSION_DELETED, { sessionId, projectId })
    // No file left to hand the worker — this must be a removal, not a parse.
    expect(mockParseSession).not.toHaveBeenCalled()
  })

  it('re-parses the parent when its session directory is removed (unlinkDir)', async () => {
    const { projectsWatcher } = makeWatcher()

    // Only the subagents-holding session directory disappears; the parent
    // .jsonl is a sibling file and is untouched.
    fs.rmSync(path.join(projectDir, sessionId), { recursive: true, force: true })
    projectsWatcher.emit('unlinkDir', path.join(projectDir, sessionId))
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_DEBOUNCE_MS)

    expect(mockParseSession).toHaveBeenCalledWith(
      parentPath,
      sessionId,
      projectId,
      expect.anything()
    )
  })

  it('tears down every known session when the whole project directory is removed (unlinkDir)', () => {
    mockPeekCachedSessionsForProject.mockReturnValue([fakeSummary(sessionId, projectId)])
    const { projectsWatcher, broadcast } = makeWatcher()

    fs.rmSync(projectDir, { recursive: true, force: true })
    projectsWatcher.emit('unlinkDir', projectDir)

    // A whole-project teardown has no single file to debounce against, so it
    // runs immediately rather than through the scheduler.
    expect(mockInvalidateCachedSummary).toHaveBeenCalledWith(parentPath)
    expect(mockRemoveCachedSession).toHaveBeenCalledWith(projectId, sessionId)
    expect(broadcast).toHaveBeenCalledWith(CHANNELS.PUSH_SESSION_DELETED, { sessionId, projectId })
  })
})

/**
 * Coalescing the re-parse onto the parent must not coalesce the secret scan
 * onto the parent too — a subagent write is what actually changed on disk,
 * and scanning only the parent's own delta would leave every subagent
 * transcript permanently unscanned even with the feature turned on. Regression
 * coverage for that: this file previously had no test with
 * `secretScanEnabled: true` at all, which is exactly how it went unnoticed.
 */
describe('FileWatcher — secret scanning after coalescing', () => {
  let claudeDir: string
  const projectId = 'proj'
  const sessionId = 'sess-1'
  let projectDir: string
  let parentPath: string
  let subagentsDir: string
  let childPath: string

  beforeEach(() => {
    vi.useFakeTimers()
    watchedInstances = []
    mockPreferencesGet.mockReturnValue({ ...BASE_PREFS, secretScanEnabled: true })
    mockParseSession.mockReset().mockResolvedValue(fakeSummary(sessionId, projectId))
    mockPatchCachedSessionSummary.mockReset()
    mockScanFileDelta.mockReset().mockResolvedValue({ findings: [], newOffset: 0 })

    claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-scan-'))
    projectDir = path.join(claudeDir, 'projects', projectId)
    parentPath = path.join(projectDir, `${sessionId}.jsonl`)
    subagentsDir = path.join(projectDir, sessionId, 'subagents')
    childPath = path.join(subagentsDir, 'agent-1.jsonl')

    fs.mkdirSync(subagentsDir, { recursive: true })
    fs.writeFileSync(parentPath, '')
    fs.writeFileSync(childPath, '')
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(claudeDir, { recursive: true, force: true })
  })

  function makeWatcher(): { projectsWatcher: FakeChokidarWatcher } {
    const broadcast = vi.fn()
    // A real toast destination: with secret scanning on, a null main window
    // would already short-circuit the scan (see scanSessionFileForSecrets),
    // which would mask exactly the regression these tests exist to catch.
    const getMainWindow = vi.fn(() => ({ webContents: { send: vi.fn() } }) as never)
    const watcher = new FileWatcher(claudeDir, { broadcast, getMainWindow })
    watcher.start()
    const [projectsWatcher] = watchedInstances
    return { projectsWatcher }
  }

  it('scans the subagent file itself, not the parent, when only a subagent writes', async () => {
    const { projectsWatcher } = makeWatcher()

    projectsWatcher.emit('change', childPath)
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_DEBOUNCE_MS)

    expect(mockScanFileDelta).toHaveBeenCalledWith(childPath, 0)
    expect(mockScanFileDelta).not.toHaveBeenCalledWith(parentPath, expect.anything())
  })

  it('scans every child that wrote during a burst while still parsing the parent once', async () => {
    const childPath2 = path.join(subagentsDir, 'agent-2.jsonl')
    fs.writeFileSync(childPath2, '')
    const { projectsWatcher } = makeWatcher()

    projectsWatcher.emit('change', childPath)
    projectsWatcher.emit('change', childPath2)
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_DEBOUNCE_MS)

    expect(mockParseSession).toHaveBeenCalledTimes(1)
    expect(mockScanFileDelta).toHaveBeenCalledWith(childPath, 0)
    expect(mockScanFileDelta).toHaveBeenCalledWith(childPath2, 0)
    expect(mockScanFileDelta).toHaveBeenCalledTimes(2)
  })

  it('still scans the parent transcript when only the parent itself changes', async () => {
    const { projectsWatcher } = makeWatcher()

    projectsWatcher.emit('change', parentPath)
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_DEBOUNCE_MS)

    expect(mockScanFileDelta).toHaveBeenCalledWith(parentPath, 0)
    expect(mockScanFileDelta).toHaveBeenCalledTimes(1)
  })
})
