import { describe, expect, it } from 'vitest'
import * as path from 'path'
import type { SessionSummary } from '@shared/types/session'
import { foldBackgroundContinuations, type UuidReader } from './background-continuations'

const DIR = '/projects/p'

function session(id: string, fields: Partial<SessionSummary> = {}): SessionSummary {
  return { id, subagents: [], ...fields } as unknown as SessionSummary
}

/** Each session's transcript uuids, served by file path. */
function reader(files: Record<string, string[]>): UuidReader {
  return async (filePath) => {
    const id = path.basename(filePath, '.jsonl')
    if (!(id in files)) throw new Error(`no transcript for ${id}`)
    return files[id]
  }
}

// The shape Claude Code writes: the copy repeats the original's records, in
// order, and goes on with its own.
const original = session('orig', { firstUuid: 'u1', lastUuid: 'u3' })
const copy = session('copy', { isBackground: true, firstUuid: 'u1', lastUuid: 'u5' })
const copyUuids = { copy: ['u1', 'u2', 'u3', 'u4', 'u5'] }

describe('foldBackgroundContinuations', () => {
  it('folds an original that stopped at the move into its background copy', async () => {
    const other = session('other', { firstUuid: 'x1', lastUuid: 'x2' })
    const { sessions, foldedIds } = await foldBackgroundContinuations(
      [original, copy, other],
      DIR,
      reader(copyUuids)
    )

    expect([...foldedIds]).toEqual(['orig'])
    expect(sessions.map((s) => s.id)).toEqual(['copy', 'other'])
    expect(sessions[0].continuesSessionIds).toEqual(['orig'])
    expect(sessions[1].continuesSessionIds).toBeUndefined()
  })

  it('keeps an original that went on after the move', async () => {
    const wentOn = session('orig', { firstUuid: 'u1', lastUuid: 'u9' })
    const { sessions, foldedIds } = await foldBackgroundContinuations(
      [wentOn, copy],
      DIR,
      reader(copyUuids)
    )
    expect(foldedIds.size).toBe(0)
    expect(sessions.map((s) => s.id)).toEqual(['orig', 'copy'])
  })

  it('keeps an original that started sub-agents of its own', async () => {
    const withAgents = session('orig', {
      firstUuid: 'u1',
      lastUuid: 'u3',
      subagents: [{ agentId: 'a1' }] as SessionSummary['subagents'],
    })
    const { foldedIds } = await foldBackgroundContinuations(
      [withAgents, copy],
      DIR,
      reader(copyUuids)
    )
    expect(foldedIds.size).toBe(0)
  })

  it('leaves sessions alone when the one sharing the start is not a background copy', async () => {
    const notBg = session('copy', { firstUuid: 'u1', lastUuid: 'u5' })
    const { foldedIds } = await foldBackgroundContinuations(
      [original, notBg],
      DIR,
      reader(copyUuids)
    )
    expect(foldedIds.size).toBe(0)
  })

  it('never hides one of two transcripts holding the same records', async () => {
    const same = session('orig', { firstUuid: 'u1', lastUuid: 'u5' })
    const { foldedIds } = await foldBackgroundContinuations([same, copy], DIR, reader(copyUuids))
    expect(foldedIds.size).toBe(0)
  })

  it('shows only the last copy when a background session is moved again', async () => {
    const again = session('again', { isBackground: true, firstUuid: 'u1', lastUuid: 'u7' })
    const { sessions } = await foldBackgroundContinuations(
      [original, copy, again],
      DIR,
      reader({ ...copyUuids, again: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'] })
    )
    expect(sessions.map((s) => s.id)).toEqual(['again'])
    expect(sessions[0].continuesSessionIds).toEqual(['orig', 'copy'])
  })

  it('keeps every session when the copy cannot be read', async () => {
    const { sessions } = await foldBackgroundContinuations([original, copy], DIR, reader({}))
    expect(sessions.map((s) => s.id)).toEqual(['orig', 'copy'])
  })
})
