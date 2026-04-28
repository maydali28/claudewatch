import * as fs from 'fs'
import * as readline from 'readline'
import type { SessionSearchResult } from '@shared/types/session'
import { assertSafePath } from '@main/lib/safe-path'
import { getProjectsDirPath } from './project-scanner'

interface SearchRequest {
  query: string
  projectIds?: string[]
}

const MAX_SNIPPETS_PER_SESSION = 3
const SNIPPET_PRE_CONTEXT_CHARS = 40
const SNIPPET_POST_CONTEXT_CHARS = 80

async function listProjectDirs(projectsDir: string, requested?: string[]): Promise<string[]> {
  if (requested && requested.length > 0) return requested
  const entries = await fs.promises.readdir(projectsDir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

async function listSessionFiles(projectPath: string): Promise<string[]> {
  const entries = await fs.promises.readdir(projectPath, { withFileTypes: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name)
}

function extractTextsFromContent(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const texts: string[] = []
  for (const block of content) {
    if (block?.text) texts.push(block.text)
    if (block?.thinking) texts.push(block.thinking)
  }
  return texts
}

function buildSnippet(text: string, queryLower: string, queryLength: number): string {
  const idx = text.toLowerCase().indexOf(queryLower)
  const start = Math.max(0, idx - SNIPPET_PRE_CONTEXT_CHARS)
  const end = Math.min(text.length, idx + queryLength + SNIPPET_POST_CONTEXT_CHARS)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

async function searchSessionFile(
  filePath: string,
  sessionId: string,
  projectId: string,
  query: string,
  queryLower: string
): Promise<SessionSearchResult | null> {
  const snippets: string[] = []
  let matchCount = 0
  let sessionTitle = sessionId

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        if (record.slug && sessionTitle === sessionId) {
          sessionTitle = record.slug
        }
        const texts = extractTextsFromContent(record.message?.content)
        for (const text of texts) {
          if (!text.toLowerCase().includes(queryLower)) continue
          matchCount++
          if (snippets.length < MAX_SNIPPETS_PER_SESSION) {
            snippets.push(buildSnippet(text, queryLower, query.length))
          }
        }
      } catch {
        // skip bad JSON lines
      }
    }
  } catch {
    return null
  }

  if (matchCount === 0) return null
  return { sessionId, projectId, sessionTitle, matchCount, snippets }
}

async function searchProject(
  projectsDir: string,
  projectId: string,
  query: string,
  queryLower: string
): Promise<SessionSearchResult[]> {
  let projectPath: string
  try {
    projectPath = assertSafePath(projectsDir, projectId)
  } catch {
    return []
  }

  let files: string[]
  try {
    files = await listSessionFiles(projectPath)
  } catch {
    return []
  }

  const results = await Promise.all(
    files.map((file) => {
      const sessionId = file.replace(/\.jsonl$/, '')
      const filePath = assertSafePath(projectsDir, projectId, file)
      return searchSessionFile(filePath, sessionId, projectId, query, queryLower)
    })
  )
  return results.filter((r): r is SessionSearchResult => r !== null)
}

/**
 * Full-text search across session JSONL files. Streams each file line-by-line
 * to avoid holding entire sessions in memory and parallelises across projects
 * and files.
 */
export async function searchSessions(req: SearchRequest): Promise<SessionSearchResult[]> {
  const { query, projectIds } = req
  if (!query.trim()) return []

  const projectsDir = getProjectsDirPath()
  const queryLower = query.toLowerCase()
  const projectDirs = await listProjectDirs(projectsDir, projectIds)

  const perProject = await Promise.all(
    projectDirs.map((projectId) => searchProject(projectsDir, projectId, query, queryLower))
  )

  const results = perProject.flat()
  results.sort((a, b) => b.matchCount - a.matchCount)
  return results
}
