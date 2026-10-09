import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import type { SessionSummary } from '@shared/types/session'

// Claude Code moves a session to the background by copying its transcript so
// far into a new session id and going on there: every record keeps its
// `uuid`, in order, and gains `sessionKind: 'bg'`. Nothing in the copy names
// the session it came from (the daemon's own record of it is gone once the
// process ends), but the shared uuids do: two transcripts that start with the
// same record uuid in one project are the same conversation.
//
// Left alone, the list showed both under one title and every total counted
// the copied responses twice. When the copy holds the original's last record
// too — the original stopped at the move — the original says nothing the copy
// does not, so it is folded in: dropped from the list and from the totals,
// and named on the copy instead. An original that went on after the move has
// records of its own and stays, and so does one that started sub-agents of its
// own: their transcripts sit under the original's id, and folding it would
// drop their spend from every total.

/** Every record `uuid` in a transcript, in file order. */
export type UuidReader = (filePath: string) => Promise<string[]>

const uuidCache = new Map<string, { mtimeMs: number; size: number; uuids: string[] }>()

/**
 * Reads the record uuids of a transcript, cached on mtime and size: a live
 * background session is re-read on every write, and only its own file is.
 */
export const readTranscriptUuids: UuidReader = async (filePath) => {
  const stat = await fs.promises.stat(filePath)
  const cached = uuidCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.uuids
  const uuids: string[] = []
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const uuid = (JSON.parse(line) as { uuid?: unknown }).uuid
      if (typeof uuid === 'string') uuids.push(uuid)
    } catch {
      // A malformed line is counted by the parsers; here it holds no uuid.
    }
  }
  uuidCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, uuids })
  return uuids
}

/**
 * One project's sessions with every background copy's original folded into
 * it. Returns the visible sessions, each copy carrying `continuesSessionIds`,
 * and the ids that were folded away.
 */
export async function foldBackgroundContinuations(
  sessions: SessionSummary[],
  projectDir: string,
  readUuids: UuidReader = readTranscriptUuids
): Promise<{ sessions: SessionSummary[]; foldedIds: Set<string> }> {
  const foldedIds = new Set<string>()
  const continues = new Map<string, string[]>()

  for (const copy of sessions) {
    if (!copy.isBackground || !copy.firstUuid) continue
    const originals = sessions.filter(
      (s) =>
        s.id !== copy.id &&
        s.firstUuid === copy.firstUuid &&
        s.lastUuid &&
        (s.subagents?.length ?? 0) === 0
    )
    if (originals.length === 0) continue

    let uuids: string[]
    try {
      uuids = await readUuids(path.join(projectDir, `${copy.id}.jsonl`))
    } catch {
      continue
    }
    for (const original of originals) {
      const at = uuids.indexOf(original.lastUuid!)
      // Strictly inside: the copy has records past the original's last one.
      // Two transcripts holding exactly the same records never hide each other.
      if (at < 0 || at === uuids.length - 1) continue
      foldedIds.add(original.id)
      continues.set(copy.id, [...(continues.get(copy.id) ?? []), original.id])
    }
  }

  if (foldedIds.size === 0) return { sessions, foldedIds }
  return {
    sessions: sessions
      .filter((s) => !foldedIds.has(s.id))
      .map((s) => {
        const ids = continues.get(s.id)
        return ids ? { ...s, continuesSessionIds: ids } : s
      }),
    foldedIds,
  }
}
