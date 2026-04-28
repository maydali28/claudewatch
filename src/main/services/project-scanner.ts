import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Project } from '@shared/types/project'
import type { SessionSummary } from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { decodeProjectId, projectDisplayName } from '@shared/utils/decode-project-id'
import { parseSessionMetadata } from './session-parser'
import { readSkillsFromDir } from './config-service'
import { getCachedSummary, pruneCachedSummaries, setCachedSummary } from './metadata-cache'
import { pLimit } from '@main/lib/p-limit'

// Cap concurrent JSONL parses across the entire scan. Empirically the parse
// is CPU-bound (JSON.parse + per-record arithmetic), so going above the core
// count buys nothing and inflates RSS by holding more streams open at once.
const SCAN_CONCURRENCY = 6

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude')
}

export function getProjectsDirPath(): string {
  const claudeDir = getClaudeDir()
  return path.join(claudeDir, 'projects')
}

// ─── scanProjects ─────────────────────────────────────────────────────────────

export interface ScanResult {
  projects: Project[]
}

export async function scanProjects(
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<ScanResult> {
  const claudeDir = getClaudeDir()
  const projectsDir = getProjectsDirPath()

  try {
    await fs.promises.access(claudeDir, fs.constants.R_OK)
    await fs.promises.access(projectsDir, fs.constants.R_OK)
  } catch {
    return { projects: [] }
  }

  const projectDirs = await listProjectsDirs(projectsDir)

  // Single shared limiter across all projects — bounding *per-file* work, not
  // per-project, so one project with 500 sessions doesn't starve the others.
  const limit = pLimit(SCAN_CONCURRENCY)
  const cachedFilePaths = new Set<string>()

  const projects = await Promise.all(
    projectDirs.map(async (projectDirName) =>
      getProjectDetails(projectDirName, pricingTable, limit, cachedFilePaths)
    )
  )

  // Drop disk-cache entries for files that no longer exist. Cheap walk over
  // the in-memory cache map — happens once per scan.
  pruneCachedSummaries(cachedFilePaths)

  const sortedProjects = projects
    .filter((project) => project.sessions.length > 0)
    .sort((firstProject, secondProject) => {
      const aLatest = firstProject.sessions?.[0]?.lastTimestamp ?? ''
      const bLatest = secondProject.sessions?.[0]?.lastTimestamp ?? ''
      return bLatest.localeCompare(aLatest)
    })

  return { projects: sortedProjects }
}

async function listProjectsDirs(projectsPath: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(projectsPath, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function listProjectJsonlFiles(projectPath: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(projectPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function readProjectCwd(projectDirName: string): Promise<string | null> {
  const projectsDir = getProjectsDirPath()
  const projectPath = path.join(projectsDir, projectDirName)
  let files: string[]
  try {
    const entries = await fs.promises.readdir(projectPath, { withFileTypes: true })
    files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name)
  } catch {
    return null
  }

  for (const file of files) {
    try {
      const filePath = path.join(projectPath, file)
      const handle = await fs.promises.open(filePath, 'r')
      const buf = Buffer.alloc(4096)
      const { bytesRead } = await handle.read(buf, 0, 4096, 0)
      await handle.close()
      const chunk = buf.subarray(0, bytesRead).toString('utf-8')
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue
        try {
          const record = JSON.parse(line)
          if (typeof record.cwd === 'string' && record.cwd) return record.cwd
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }
  return null
}

async function getProjectDetails(
  projectDirName: string,
  pricingTable: Record<ModelFamily, ModelPricing>,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  cachedFilePaths: Set<string>
): Promise<Project> {
  const projectsDir = getProjectsDirPath()
  const decodedPath = decodeProjectId(projectDirName)

  const [sessions, realCwd] = await Promise.all([
    getValidSortedSessionForProject(
      projectDirName,
      projectsDir,
      pricingTable,
      limit,
      cachedFilePaths
    ),
    readProjectCwd(projectDirName),
  ])

  const displayName = projectDisplayName(realCwd ?? decodedPath)

  const [localSkills, localClaudeMd] = realCwd
    ? await Promise.all([
        readSkillsFromDir(path.join(realCwd, '.claude', 'skills')),
        fs.promises.readFile(path.join(realCwd, 'CLAUDE.md'), 'utf-8').catch(() => null),
      ])
    : [[], null]

  return {
    id: projectDirName,
    name: displayName,
    path: realCwd ?? decodedPath,
    sessions,
    sessionCount: sessions.length,
    localSkills,
    localClaudeMd,
  }
}

async function getValidSortedSessionForProject(
  projectDirName: string,
  projectsDir: string,
  pricingTable: Record<ModelFamily, ModelPricing>,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  cachedFilePaths: Set<string>
): Promise<SessionSummary[]> {
  const projectPath = path.join(projectsDir, projectDirName)
  const jsonlFiles = await listProjectJsonlFiles(projectPath)

  if (jsonlFiles.length === 0) {
    return []
  }

  // Each file goes through the shared limiter so the whole scan stays under
  // SCAN_CONCURRENCY in-flight parses regardless of how many projects exist.
  const summaries = await Promise.all(
    jsonlFiles.map((file) =>
      limit(() =>
        getSessionSummaryFromJsonlFile(file, projectDirName, pricingTable, cachedFilePaths)
      )
    )
  )

  return summaries
    .filter(
      (summary): summary is SessionSummary => summary !== null && summary.lastTimestamp !== ''
    )
    .sort((firstSum, secondSum) => {
      const firstSumLatest = new Date(firstSum.lastTimestamp).getTime()
      const secondSumLatest = new Date(secondSum.lastTimestamp).getTime()
      return secondSumLatest - firstSumLatest
    })
}

async function getSessionSummaryFromJsonlFile(
  jsonFileName: string,
  projectDirName: string,
  pricingTable: Record<ModelFamily, ModelPricing>,
  cachedFilePaths: Set<string>
): Promise<SessionSummary | null> {
  const filePath = path.join(getProjectsDirPath(), projectDirName, jsonFileName)
  const sessionId = jsonFileName.replace(/\.jsonl$/, '')
  cachedFilePaths.add(filePath)

  try {
    // Cheap stat → cache hit avoids a full JSONL parse on subsequent launches
    // for any session that hasn't been written to since we last saw it.
    const stat = await fs.promises.stat(filePath)
    const cached = getCachedSummary(filePath, stat.mtimeMs, stat.size)
    if (cached) return cached

    const summary = await parseSessionMetadata(filePath, sessionId, projectDirName, pricingTable)
    setCachedSummary(filePath, stat.mtimeMs, stat.size, summary)
    return summary
  } catch {
    return null
  }
}
