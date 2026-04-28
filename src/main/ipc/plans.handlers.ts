import { ipcMain } from 'electron'
import * as fs from 'fs/promises'
import { createReadStream } from 'fs'
import * as readline from 'readline'
import * as path from 'path'
import * as os from 'os'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, PlansGetSchema, PlansGetProjectsSchema } from '@shared/ipc/schemas'
import type { PlanSummary, PlanDetail } from '@shared/types'

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

const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans')
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

function projectNameFromDirName(dirName: string): string {
  // Directory names are encoded paths like "-Users-foo-Workspace-my-project"
  const parts = dirName.replace(/^-/, '').split('-')
  // Return last meaningful segment as the project name
  return parts[parts.length - 1] || dirName
}

function extractTitle(content: string, filename: string): string {
  const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? ''
  if (firstLine.startsWith('#')) return firstLine.replace(/^#+\s*/, '').trim()
  return filename.replace(/\.md$/, '').replace(/[-_]/g, ' ')
}

export function registerPlansHandlers(): void {
  ipcMain.handle(CHANNELS.PLANS_LIST, async () => {
    try {
      let entries: string[]
      try {
        entries = await fs.readdir(PLANS_DIR)
      } catch {
        return ok<PlanSummary[]>([])
      }

      const mdFiles = entries.filter((f) => f.endsWith('.md'))

      const summaries = await Promise.all(
        mdFiles.map(async (filename): Promise<PlanSummary | null> => {
          try {
            const filePath = path.join(PLANS_DIR, filename)
            const [content, stat] = await Promise.all([
              fs.readFile(filePath, 'utf-8'),
              fs.stat(filePath),
            ])
            return {
              id: filename,
              filename,
              title: extractTitle(content, filename),
              createdAt: stat.birthtime.toISOString(),
              sizeBytes: stat.size,
            }
          } catch {
            return null
          }
        })
      )

      const valid = summaries
        .filter((s): s is PlanSummary => s !== null)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

      return ok(valid)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })

  ipcMain.handle(CHANNELS.PLANS_GET_PROJECTS, async (_event, raw) => {
    try {
      const { slug } = validate(PlansGetProjectsSchema, raw)
      let projectDirs: string[]
      try {
        projectDirs = await fs.readdir(PROJECTS_DIR)
      } catch {
        return ok<string[]>([])
      }

      const matchedProjects = new Set<string>()

      await Promise.all(
        projectDirs.map(async (dirName) => {
          const dirPath = path.join(PROJECTS_DIR, dirName)
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

          const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'))
          for (const jsonlFile of jsonlFiles) {
            if (await jsonlContainsSlug(path.join(dirPath, jsonlFile), slug)) {
              matchedProjects.add(projectNameFromDirName(dirName))
              break
            }
          }
        })
      )

      return ok(Array.from(matchedProjects).sort())
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })

  ipcMain.handle(CHANNELS.PLANS_GET, async (_event, raw) => {
    try {
      const { filename } = validate(PlansGetSchema, raw)
      // Defence-in-depth: even though the schema rejects path separators, strip
      // any directory component so a future schema relaxation can't escape PLANS_DIR.
      const safe = path.basename(filename)

      const filePath = path.join(PLANS_DIR, safe)
      const content = await fs.readFile(filePath, 'utf-8')
      const detail: PlanDetail = {
        filename: safe,
        title: extractTitle(content, safe),
        content,
      }
      return ok(detail)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e))
    }
  })
}
