import * as fs from 'fs/promises'
import { createReadStream, type Dirent } from 'fs'
import * as readline from 'readline'
import * as path from 'path'
import { getDefaultPlansDirPath, getProjectsDirPath } from '@main/lib/claude-paths'
import { readSettingsLayers, mergeSettingsLayers } from './config-service'
import type { ProjectRootRef, RawSettings } from '@shared/types/config'
import type { PlanSummary, PlanDetail } from '@shared/types/plan'

// A directory plans were resolved from, plus enough context to label the
// plans found in it: the default `<claudeDir>/plans` (`scope: 'default'`) or
// a project's configured `plansDirectory` (`scope: 'project'`).
export interface PlanDirectory {
  directory: string
  scope: 'default' | 'project'
  project?: ProjectRootRef
}

// Structurally compatible with `Project` (from `@shared/types/project`) —
// declared narrower here so this module stays free of that type (and the
// IPC-adjacent scanning code that produces it). Only `id`, `name` and each
// session's `projectId` are read.
export interface ProjectNameLookup {
  id: string
  name: string
  sessions: Array<{ projectId: string }>
}

// Scan a JSONL for a slug occurrence line-by-line and return as soon as one
// is found. Session files put the slug on the first summary line, so the
// common case reads a single line instead of the full megabytes-large file.
async function jsonlContainsSlug(filePath: string, slug: string): Promise<boolean> {
  const needleA = `"slug":"${slug}"`
  const needleB = `"slug": "${slug}"`
  let stream: ReturnType<typeof createReadStream> | null = null
  try {
    stream = createReadStream(filePath, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      if (line.includes(needleA) || line.includes(needleB)) {
        rl.close()
        return true
      }
    }
    return false
  } catch {
    return false
  } finally {
    stream?.destroy()
  }
}

function extractTitle(content: string, filename: string): string {
  const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? ''
  if (firstLine.startsWith('#')) return firstLine.replace(/^#+\s*/, '').trim()
  return filename.replace(/\.md$/, '').replace(/[-_]/g, ' ')
}

/**
 * Resolves a project's `plansDirectory` setting against its root, following
 * the docs rule verbatim: "Claude Code resolves the path relative to the
 * project root and keeps the default when the path resolves outside it."
 * An unset, empty or whitespace-only value is treated the same as unset.
 */
export function planDirectoryFor(
  settings: RawSettings,
  projectRoot: string,
  defaultDir: string
): string {
  // `RawSettings.plansDirectory` is typed as `string | undefined`, but the
  // value comes from a hand-editable JSON file on disk — a wrong type
  // (a number, an array, ...) must be treated as unset, not thrown on.
  const raw = settings.plansDirectory
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return defaultDir

  const resolved = path.resolve(projectRoot, value)
  const rel = path.relative(projectRoot, resolved)
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return defaultDir
  return resolved
}

/**
 * The default plans dir plus, for every resolved project whose merged
 * settings set `plansDirectory`, that path resolved against the project
 * root — kept only when it stays inside the root (docs rule). Deduplicated,
 * and the default dir is always included exactly once, even when a
 * project's `plansDirectory` resolves back to it.
 */
export async function resolvePlanDirectories(projects: ProjectRootRef[]): Promise<PlanDirectory[]> {
  const defaultDir = getDefaultPlansDirPath()
  const dirs: PlanDirectory[] = [{ directory: defaultDir, scope: 'default' }]
  const seen = new Set<string>([defaultDir])

  for (const project of projects) {
    // One project's unreadable or malformed settings must not blank the Plans
    // view for all of them: that project falls back to the default directory,
    // which is already in the list, and the rest still resolve.
    let dir = defaultDir
    try {
      const settings = mergeSettingsLayers(await readSettingsLayers(project))
      dir = planDirectoryFor(settings, project.path, defaultDir)
    } catch {
      dir = defaultDir
    }
    if (seen.has(dir)) continue
    seen.add(dir)
    dirs.push({ directory: dir, scope: 'project', project })
  }

  return dirs
}

async function listPlansInDir(dir: PlanDirectory): Promise<PlanSummary[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir.directory, { withFileTypes: true })
  } catch {
    return []
  }

  // `isFile()` reflects the directory entry's own type (like `lstat`), so a
  // symlink — even one pointing at a real `.md` file elsewhere — is excluded
  // here rather than silently followed and listed.
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)

  const summaries = await Promise.all(
    mdFiles.map(async (filename): Promise<PlanSummary | null> => {
      try {
        const filePath = path.join(dir.directory, filename)
        const [content, stat] = await Promise.all([
          fs.readFile(filePath, 'utf-8'),
          fs.stat(filePath),
        ])
        return {
          id: filePath,
          filename,
          title: extractTitle(content, filename),
          directory: dir.directory,
          scope: dir.scope,
          projectId: dir.project?.id,
          projectName: dir.project?.name,
          createdAt: stat.birthtime.toISOString(),
          sizeBytes: stat.size,
        }
      } catch {
        return null
      }
    })
  )

  return summaries.filter((s): s is PlanSummary => s !== null)
}

/** Every plan across `dirs`, most recently created first. A missing directory
 * (a project `plansDirectory` that doesn't exist yet) yields no plans rather
 * than failing the whole list. */
export async function listPlans(dirs: PlanDirectory[]): Promise<PlanSummary[]> {
  const perDir = await Promise.all(dirs.map(listPlansInDir))
  return perDir.flat().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

// Mirrors the old `plans:get` IPC schema's filename validator: a plain
// `.md` basename, no path separators (so no `..`, no `.`, nothing that could
// smuggle a directory component past `path.basename`).
const PLAN_FILENAME_RE = /^[^/\\]+\.md$/

/**
 * Rejects any id that is not `<dir>/<basename>` for one of `dirs`, with two
 * further guards beyond that path match, both because a resolved plan dir
 * can legitimately be a project's own root (`plansDirectory: "."`) or any
 * other directory that also holds non-plan files or symlinks:
 *  - the basename must look like a plan file (`PLAN_FILENAME_RE`) — this
 *    alone also rejects a basename of `.` or `..`, which `path.join` would
 *    otherwise resolve right back to a real path inside (or above) `dir`;
 *  - the file's real path (after following any symlink) must live directly
 *    inside the directory's own real path — `path.resolve` never follows
 *    symlinks, so a `.md` file that is actually a symlink pointing outside
 *    `dir` would otherwise match on path alone and get its target's content
 *    served back.
 */
export async function readPlan(id: string, dirs: PlanDirectory[]): Promise<PlanDetail> {
  const filename = path.basename(id)
  if (!PLAN_FILENAME_RE.test(filename)) throw new Error('Plan not found')

  const dir = dirs.find((d) => path.join(d.directory, filename) === path.resolve(id))
  if (!dir) throw new Error('Plan not found')

  const filePath = path.join(dir.directory, filename)

  let realFile: string
  let realDir: string
  try {
    ;[realFile, realDir] = await Promise.all([fs.realpath(filePath), fs.realpath(dir.directory)])
  } catch {
    throw new Error('Plan not found')
  }
  if (path.dirname(realFile) !== realDir) throw new Error('Plan not found')

  const content = await fs.readFile(filePath, 'utf-8')

  return {
    id: filePath,
    filename,
    title: extractTitle(content, filename),
    content,
    directory: dir.directory,
  }
}

/**
 * Display names of the projects whose transcripts mention `slug`, resolved
 * by scanning `~/.claude/projects/<dir>` for a matching JSONL and mapping
 * each matched directory back to the (possibly worktree-merged) project
 * that owns it via `session.projectId`, which — unlike `Project.id` — keeps
 * the raw scanned directory name for every member of a merged group. Each
 * name appears once even when several of a merged project's directories match.
 */
export async function projectNamesForSlug(
  slug: string,
  projects: ProjectNameLookup[]
): Promise<string[]> {
  const projectsDir = getProjectsDirPath()
  let dirNames: string[]
  try {
    dirNames = await fs.readdir(projectsDir)
  } catch {
    return []
  }

  const matchedDirNames = new Set<string>()
  await Promise.all(
    dirNames.map(async (dirName) => {
      const dirPath = path.join(projectsDir, dirName)
      let stat: Awaited<ReturnType<typeof fs.stat>>
      try {
        stat = await fs.stat(dirPath)
      } catch {
        return
      }
      if (!stat.isDirectory()) return

      let files: string[]
      try {
        files = await fs.readdir(dirPath)
      } catch {
        return
      }

      for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
        if (await jsonlContainsSlug(path.join(dirPath, file), slug)) {
          matchedDirNames.add(dirName)
          break
        }
      }
    })
  )

  const names = new Set<string>()
  for (const project of projects) {
    const ownedDirNames = new Set([project.id, ...project.sessions.map((s) => s.projectId)])
    if ([...matchedDirNames].some((d) => ownedDirNames.has(d))) {
      names.add(project.name)
    }
  }
  return [...names].sort()
}
