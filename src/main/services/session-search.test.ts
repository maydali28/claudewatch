import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUBAGENT_PARSE_CONCURRENCY } from '@shared/constants/tuning'

// `fs.promises.readdir` drives both directory listings that fan out below
// (projects, then session files per project). Each test controls its timing
// directly through this mock rather than touching the real filesystem.
const mockReaddir = vi.fn()
vi.mock('fs', () => ({
  promises: { readdir: (...args: unknown[]) => mockReaddir(...args) },
  createReadStream: () => ({}),
}))

// `searchSessionFile` reads each file through readline; replacing it with a
// hand-controlled async iterator lets a test hold a "read" open indefinitely
// so it can observe how many are open at once, without any real file I/O.
let activeReads = 0
let maxActiveReads = 0
let readGates: Array<() => void> = []
vi.mock('readline', () => ({
  createInterface: () => ({
    [Symbol.asyncIterator]: () => {
      let finished = false
      return {
        next: () => {
          if (finished) return Promise.resolve({ done: true, value: undefined })
          activeReads++
          maxActiveReads = Math.max(maxActiveReads, activeReads)
          return new Promise((resolve) => {
            readGates.push(() => {
              activeReads--
              finished = true
              resolve({ done: true, value: undefined })
            })
          })
        },
      }
    },
  }),
}))

import { searchSessions } from './session-search'
import { getProjectsDirPath } from '@main/lib/claude-paths'

function fakeDirent(
  name: string,
  isDir: boolean
): {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
} {
  return { name, isDirectory: () => isDir, isFile: () => !isDir }
}

/** Flush every microtask queued by resolved mock promises before the next assertion. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('searchSessions — bounded fan-out', () => {
  const projectsDir = getProjectsDirPath()

  beforeEach(() => {
    mockReaddir.mockReset()
    activeReads = 0
    maxActiveReads = 0
    readGates = []
  })

  afterEach(() => {
    // Release anything left hanging so a failed assertion doesn't leak a
    // dangling promise into the next test.
    readGates.splice(0).forEach((release) => release())
  })

  /**
   * Two nested `Promise.all` fan-outs used to open every session file (across
   * every project) at once. A user with hundreds of subagent-heavy sessions
   * could exhaust file handles and starve the event loop from one search.
   * Both are now bounded by the same `pLimit` cap the subagent parser already
   * uses (`SUBAGENT_PARSE_CONCURRENCY`), rather than a newly invented number.
   */
  it('caps concurrent file reads within a single project at the subagent-parser concurrency', async () => {
    const totalFiles = SUBAGENT_PARSE_CONCURRENCY + 1

    mockReaddir.mockImplementation((dirPath: string) => {
      if (path.resolve(dirPath) === path.resolve(projectsDir)) {
        return Promise.resolve([fakeDirent('proj', true)])
      }
      const files = Array.from({ length: totalFiles }, (_, i) => fakeDirent(`s${i}.jsonl`, false))
      return Promise.resolve(files)
    })

    const resultPromise = searchSessions({ query: 'secret' })

    await tick()
    // Only the cap's worth of reads should be open — the (cap + 1)th file is
    // still queued, not running.
    expect(activeReads).toBe(SUBAGENT_PARSE_CONCURRENCY)

    readGates.splice(0).forEach((release) => release())
    await tick()
    // Releasing the first batch lets exactly the queued remainder start.
    expect(activeReads).toBe(1)

    readGates.splice(0).forEach((release) => release())
    await resultPromise

    expect(maxActiveReads).toBe(SUBAGENT_PARSE_CONCURRENCY)
  })

  it('caps concurrent per-project searches at the same concurrency', async () => {
    const totalProjects = SUBAGENT_PARSE_CONCURRENCY + 1
    let activeProjectScans = 0
    let maxActiveProjectScans = 0
    const projectGates: Array<() => void> = []

    mockReaddir.mockImplementation((dirPath: string) => {
      if (path.resolve(dirPath) === path.resolve(projectsDir)) {
        const dirs = Array.from({ length: totalProjects }, (_, i) => fakeDirent(`p${i}`, true))
        return Promise.resolve(dirs)
      }
      // Per-project file listing: hang until released, standing in for slow
      // I/O so the test can observe how many project scans run at once.
      activeProjectScans++
      maxActiveProjectScans = Math.max(maxActiveProjectScans, activeProjectScans)
      return new Promise((resolve) => {
        projectGates.push(() => {
          activeProjectScans--
          resolve([])
        })
      })
    })

    const resultPromise = searchSessions({ query: 'secret' })

    await tick()
    expect(activeProjectScans).toBe(SUBAGENT_PARSE_CONCURRENCY)

    projectGates.splice(0).forEach((release) => release())
    await tick()
    expect(activeProjectScans).toBe(1)

    projectGates.splice(0).forEach((release) => release())
    await resultPromise

    expect(maxActiveProjectScans).toBe(SUBAGENT_PARSE_CONCURRENCY)
  })
})
