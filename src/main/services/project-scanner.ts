import * as fs from 'fs'
import * as path from 'path'
import type { Project } from '@shared/types/project'
import type { SessionSummary } from '@shared/types/session'
import type { SkillEntry } from '@shared/types/config'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { decodeProjectId, projectDisplayName } from '@shared/utils/decode-project-id'
import { currentTimezone, compareTimestampsAscending } from '@shared/utils/date-ranges'
import { getClaudeDir, getProjectsDirPath, getUserSkillsDirPath } from '@main/lib/claude-paths'
import { samePath } from '@main/lib/same-path'
import { parseSessionMetadata } from './session-parser'
import { childFingerprint } from './parsers/child-fingerprint'
import { readSkillsFromDir } from './config-service'
import { getCachedSummary, pruneCachedSummaries, setCachedSummary } from './metadata-cache'
import { pricingFingerprint } from './pricing-engine'
import { pLimit } from '@main/lib/p-limit'

// Cap concurrent JSONL parses across the entire scan. Empirically the parse
// is CPU-bound (JSON.parse + per-record arithmetic), so going above the core
// count buys nothing and inflates RSS by holding more streams open at once.
const SCAN_CONCURRENCY = 6

// ─── scanProjects ─────────────────────────────────────────────────────────────

export interface ScanResult {
  projects: Project[]
}

export async function scanProjects(
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<ScanResult> {
  // Computed once and threaded down as a plain argument (not stashed in
  // module state): the worker handles requests concurrently, so a second
  // scanProjects/parseSession call for a different table can be in flight at
  // the same time as this one. Passing it explicitly to every cache call
  // keeps this scan's reads/writes correct regardless of what else the
  // worker is doing concurrently.
  const pricingFp = pricingFingerprint(pricingTable)
  // Same reasoning as `pricingFp` above, applied to the reporting timezone
  // stamped on the metadata cache (see `metadata-cache.ts`'s `CacheFile.timezone`).
  const timezone = currentTimezone()

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

  const scanned = await Promise.all(
    projectDirs.map(async (projectDirName) =>
      getProjectDetails(projectDirName, pricingTable, pricingFp, timezone, limit, cachedFilePaths)
    )
  )

  // Drop disk-cache entries for files that no longer exist. Cheap walk over
  // the in-memory cache map — happens once per scan.
  pruneCachedSummaries(cachedFilePaths)

  // Claude Code gives a git worktree its own `~/.claude/projects/<encoded-cwd>`
  // directory even though it's the same working directory as the main
  // checkout, so one project can arrive here as several `projectDirs` entries
  // that all resolved to the same real `cwd`. Collapse those before sorting —
  // see `mergeProjectsByResolvedPath`.
  const merged = mergeProjectsByResolvedPath(scanned)

  const sortedProjects = sortProjectsByLatestSession(
    merged.filter((project) => project.sessions.length > 0)
  )

  return { projects: sortedProjects }
}

/**
 * One project directory's scan result, before the cross-directory merge.
 *
 * `resolved` says whether `project.path` came from an actually-resolved cwd
 * (a `cwd` field read straight out of a transcript, or a session's own
 * `projectPath`) rather than `decodeProjectId`'s lossy fallback — see the
 * `resolvedCwd` computation in `getProjectDetails`. `mergeProjectsByResolvedPath`
 * needs this distinction to know which paths are trustworthy enough to merge
 * projects on.
 */
export interface ScannedProject {
  project: Project
  resolved: boolean
}

/**
 * Collapses project directories that resolve to the identical real `cwd`
 * into a single entry — e.g. a main checkout and the git worktrees under
 * `.claude/worktrees/`, which Claude Code gives their own
 * `~/.claude/projects/<encoded-cwd>` directory despite all being one working
 * directory. Without this, the sessions sidebar shows the same project once
 * per directory. See rulings in
 * `.superpowers/sdd/2026-09-15-post-1.4.0-defect-fixes/task-6-brief.md`.
 *
 * Grouping happens ONLY among entries whose path was actually resolved
 * (ruling 1). Unresolved entries fall back to `decodeProjectId`, which is
 * lossy — every "-" becomes "/", so two genuinely different directories can
 * decode to the identical wrong string. Grouping on that string would merge
 * projects that are not actually the same cwd, so every unresolved entry is
 * kept standalone instead, however many other entries share its fallback
 * path (ruling 5).
 */
export function mergeProjectsByResolvedPath(scanned: ScannedProject[]): Project[] {
  const resolvedGroups = new Map<string, Project[]>()
  const standalone: Project[] = []

  for (const { project, resolved } of scanned) {
    if (!resolved) {
      standalone.push(project)
      continue
    }
    const group = resolvedGroups.get(project.path)
    if (group) group.push(project)
    else resolvedGroups.set(project.path, [project])
  }

  const merged = [...resolvedGroups.values()].map((group) =>
    group.length === 1 ? group[0] : mergeProjectGroup(group)
  )

  return [...merged, ...standalone]
}

/**
 * Combines several project directories already known to share one real
 * `cwd` into a single `Project`.
 *
 * - `id`: the lexicographically smallest of the group's original directory
 *   ids. Deterministic regardless of scan order (the `Promise.all` in
 *   `scanProjects` makes no guarantee about which directory's
 *   `getProjectDetails` settles first) and stable across scans as long as
 *   the same directories exist on disk — which is what keeps
 *   `activeProjectId`, analytics project filters, and IPC payloads pointed
 *   at the same project between one scan and the next (ruling 3).
 *
 *   This is also stable against a NEW worktree sibling appearing, not just
 *   against scan order — checked, not assumed: Claude Code names a worktree's
 *   project directory by literally appending `--claude-worktrees-<name>` to
 *   the checkout's own encoded id (confirmed against this repo's real
 *   `~/.claude/projects/` entries), so every worktree id is a strict
 *   superstring of the checkout's id. In lexicographic order a string that is
 *   a strict prefix of another always sorts first, regardless of what
 *   characters follow it — so the checkout's id can never stop being the
 *   smallest of the group no matter what a new worktree is named (a
 *   `--claude-worktrees-aaa...` suffix sorts after the checkout exactly like
 *   a `--claude-worktrees-zzz...` one does). A helper that explicitly
 *   "prefers the canonical checkout" would therefore always compute the same
 *   id the plain sort already does for this identifier scheme — proved, not
 *   left as an assumption, in `project-scanner.test.ts`'s "a new worktree
 *   sibling never flips the survivor" test — so none was added; it would be
 *   the kind of helper nothing's output ever differs through. The residual
 *   case this does NOT cover is a sibling directory that resolves to the
 *   SAME cwd through some other means entirely (not a `.claude/worktrees`
 *   directory, so no shared-prefix relationship) and happens to sort before
 *   the checkout — that can still flip the survivor, same as it could
 *   before; fixing it would need persisted cross-scan selection state, which
 *   is a materially bigger change than a deterministic pure function and is
 *   left as an open follow-up rather than attempted here.
 * - `name` / `path`: identical across the group by construction — matching
 *   `path` is the merge key, and `name` is derived from it — so any member's
 *   value is the group's value.
 * - `sessions`: the union of every member's sessions, re-sorted with the
 *   existing time-based comparator so the merged list is still
 *   most-recent-first; `sessionCount` is its length (ruling 2).
 * - `localSkills`: the union of every member's skills, deduped by `id` (the
 *   skill's directory name). Every member shares the same resolved cwd, so
 *   `.claude/skills` under it is literally the same directory read multiple
 *   times over — the lists are expected to be identical, and deduping rather
 *   than taking one member's list outright makes that an explicit, checkable
 *   merge rule instead of an assumption.
 * - `localClaudeMd`: the first non-null content among the group. Same
 *   reasoning as skills — every member read the same `CLAUDE.md` path — but
 *   a transient read failure on one member (`getProjectDetails` reads it via
 *   `.catch(() => null)`) must not blank out a value another member did
 *   read successfully.
 */
function mergeProjectGroup(projects: Project[]): Project {
  const survivorId = [...projects].map((p) => p.id).sort()[0]
  const sessions = sortSessionsByLatestTimestamp(projects.flatMap((p) => p.sessions))

  const skillsById = new Map<string, SkillEntry>()
  for (const p of projects) {
    for (const skill of p.localSkills) {
      if (!skillsById.has(skill.id)) skillsById.set(skill.id, skill)
    }
  }

  return {
    id: survivorId,
    name: projects[0].name,
    path: projects[0].path,
    // A group is only ever formed from resolved members.
    pathResolved: true,
    sessions,
    sessionCount: sessions.length,
    localSkills: [...skillsById.values()],
    localClaudeMd: projects.map((p) => p.localClaudeMd).find((md) => md !== null) ?? null,
  }
}

/**
 * Most-recently-active project first. Split out from `scanProjects` (which
 * touches disk) so the ordering rule itself — including how it treats a
 * project with no valid session timestamp — can be tested without mocking
 * the filesystem.
 *
 * Compares parsed instants (`compareTimestampsAscending`), not raw text: a
 * `lastTimestamp` is whatever the transcript wrote, with no guaranteed `Z`
 * suffix, and a `.localeCompare` here previously ordered the sidebar's
 * project list by digits instead of by time — the same defect fixed in the
 * accounting projection's "latest model" badge and the sessions table's
 * "Last active" sort.
 */
export function sortProjectsByLatestSession(projects: Project[]): Project[] {
  return [...projects].sort((firstProject, secondProject) => {
    const aLatest = firstProject.sessions?.[0]?.lastTimestamp ?? ''
    const bLatest = secondProject.sessions?.[0]?.lastTimestamp ?? ''
    return compareTimestampsAscending(bLatest, aLatest)
  })
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

/**
 * A project's own skills from `<root>/.claude/skills`. A project rooted at the
 * home directory (`claude` run in `~`, possibly through a symlink) has the
 * user skills folder there; those are user skills, not listed again here.
 */
function readProjectSkills(root: string): Promise<SkillEntry[]> {
  const dir = path.join(root, '.claude', 'skills')
  return samePath(dir, getUserSkillsDirPath()) ? Promise.resolve([]) : readSkillsFromDir(dir)
}

async function getProjectDetails(
  projectDirName: string,
  pricingTable: Record<ModelFamily, ModelPricing>,
  pricingFp: string,
  timezone: string,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  cachedFilePaths: Set<string>
): Promise<ScannedProject> {
  const projectsDir = getProjectsDirPath()
  const decodedPath = decodeProjectId(projectDirName)

  const [sessions, realCwd] = await Promise.all([
    getValidSortedSessionForProject(
      projectDirName,
      projectsDir,
      pricingTable,
      pricingFp,
      timezone,
      limit,
      cachedFilePaths
    ),
    readProjectCwd(projectDirName),
  ])

  // `decodeProjectId` is lossy: it turns every "-" into "/", so directories whose
  // name contains hyphens decode to the wrong path (and thus the wrong display name).
  // Prefer a real cwd from the session records — the same source the tray uses — so the
  // dashboard project name matches the tray. Sessions are sorted most-recent-first.
  const sessionCwd = sessions.map((s) => s.projectPath).find((p) => p && p !== decodedPath)
  const resolvedCwd = realCwd ?? sessionCwd ?? null
  const projectPath = resolvedCwd ?? decodedPath
  const displayName = projectDisplayName(projectPath)

  const [localSkills, localClaudeMd] = resolvedCwd
    ? await Promise.all([
        readProjectSkills(resolvedCwd),
        fs.promises.readFile(path.join(resolvedCwd, 'CLAUDE.md'), 'utf-8').catch(() => null),
      ])
    : [[], null]

  return {
    project: {
      id: projectDirName,
      name: displayName,
      path: projectPath,
      pathResolved: resolvedCwd !== null,
      sessions,
      sessionCount: sessions.length,
      localSkills,
      localClaudeMd,
    },
    resolved: resolvedCwd !== null,
  }
}

async function getValidSortedSessionForProject(
  projectDirName: string,
  projectsDir: string,
  pricingTable: Record<ModelFamily, ModelPricing>,
  pricingFp: string,
  timezone: string,
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
        getSessionSummaryFromJsonlFile(
          file,
          projectDirName,
          pricingTable,
          pricingFp,
          timezone,
          cachedFilePaths
        )
      )
    )
  )

  return sortSessionsByLatestTimestamp(
    summaries.filter(
      (summary): summary is SessionSummary => summary !== null && summary.lastTimestamp !== ''
    )
  )
}

/**
 * Most-recent-first within one project's own sessions. Split out from
 * `getValidSortedSessionForProject` (which touches disk) for the same reason
 * `sortProjectsByLatestSession` above was split out of `scanProjects` — so
 * the ordering rule itself, including how it treats an unparsable
 * `lastTimestamp`, can be tested without mocking the filesystem.
 *
 * The caller's `!== ''` filter only rejects an absent timestamp, not a
 * malformed non-empty one, so a raw `getTime()` subtraction here could still
 * hit `NaN` — the same comparator bug already fixed via
 * `compareTimestampsAscending` at every other timestamp-sort call site,
 * including `sortProjectsByLatestSession` in this same file. Arguments
 * swapped, not negated, for descending order, so an unparsable timestamp
 * still sorts last rather than landing wherever NaN's semantics happen to
 * put it.
 */
export function sortSessionsByLatestTimestamp(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => compareTimestampsAscending(b.lastTimestamp, a.lastTimestamp))
}

async function getSessionSummaryFromJsonlFile(
  jsonFileName: string,
  projectDirName: string,
  pricingTable: Record<ModelFamily, ModelPricing>,
  pricingFp: string,
  timezone: string,
  cachedFilePaths: Set<string>
): Promise<SessionSummary | null> {
  const filePath = path.join(getProjectsDirPath(), projectDirName, jsonFileName)
  const sessionId = jsonFileName.replace(/\.jsonl$/, '')
  cachedFilePaths.add(filePath)

  try {
    // Cheap stat → cache hit avoids a full JSONL parse on subsequent launches
    // for any session that hasn't been written to since we last saw it.
    const stat = await fs.promises.stat(filePath)
    const childFp = await childFingerprint(
      path.join(getProjectsDirPath(), projectDirName),
      sessionId
    )
    const cached = getCachedSummary(filePath, stat.mtimeMs, stat.size, childFp, pricingFp, timezone)
    if (cached) return cached

    const summary = await parseSessionMetadata(filePath, sessionId, projectDirName, pricingTable)
    setCachedSummary(filePath, stat.mtimeMs, stat.size, childFp, pricingFp, timezone, summary)
    return summary
  } catch {
    return null
  }
}
