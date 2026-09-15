import * as fs from 'fs'
import * as path from 'path'

/**
 * Identity of every subagent transcript rolled into a session's cached
 * summary.
 *
 * The cached summary contains subagent usage, so the parent transcript's own
 * mtime and size do not describe it. A child written after the parent — or
 * while the app was closed — previously served a stale total forever, since
 * the parent's own fingerprint never changed.
 *
 * Shared between `project-scanner.ts` (cold-scan lookups) and
 * `worker-entry.ts` (live re-parse write-through): both must derive the exact
 * same string for the same directory, or the two paths would disagree about
 * whether an entry is stale — precisely the class of bug this fixes.
 *
 * Sorted because `readdir` order is not guaranteed; an unsorted fingerprint
 * would change spuriously across runs and defeat the cache.
 */
export async function childFingerprint(projectDir: string, sessionId: string): Promise<string> {
  const dir = path.join(projectDir, sessionId, 'subagents')
  let entries: string[]
  try {
    entries = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort()
  } catch {
    return ''
  }
  const parts: string[] = []
  for (const name of entries) {
    const s = await fs.promises.stat(path.join(dir, name))
    parts.push(`${name}:${s.mtimeMs}:${s.size}`)
  }
  return parts.join('|')
}
