import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { childFingerprint } from './child-fingerprint'

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'child-fingerprint-'))
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('childFingerprint', () => {
  it('returns the empty string when the session has no subagents directory', async () => {
    const sessionId = 'no-subagents'
    fs.mkdirSync(path.join(dir, sessionId), { recursive: true })

    expect(await childFingerprint(dir, sessionId)).toBe('')
  })

  it('is stable regardless of the order readdir returns entries in', async () => {
    // One real directory with two real files — the underlying (name, mtime,
    // size) data is identical across both calls below. Only the order
    // readdir hands back the names differs, which is the one thing the OS
    // does not guarantee. If the implementation forgot to sort, this would
    // produce two different fingerprints for the exact same set of children.
    const sessionId = 'session-order'
    const subdir = path.join(dir, sessionId, 'subagents')
    fs.mkdirSync(subdir, { recursive: true })
    fs.writeFileSync(path.join(subdir, 'agent-a.jsonl'), 'agent-a content')
    fs.writeFileSync(path.join(subdir, 'agent-b.jsonl'), 'agent-b longer content!')

    const readdirSpy = vi.spyOn(fs.promises, 'readdir')
    readdirSpy.mockResolvedValueOnce(['agent-b.jsonl', 'agent-a.jsonl'] as never)
    const fpFirstOrder = await childFingerprint(dir, sessionId)

    readdirSpy.mockResolvedValueOnce(['agent-a.jsonl', 'agent-b.jsonl'] as never)
    const fpSecondOrder = await childFingerprint(dir, sessionId)

    expect(fpFirstOrder).not.toBe('')
    expect(fpFirstOrder).toBe(fpSecondOrder)
  })

  it('changes when a child transcript is modified', async () => {
    const sessionId = 'session-mutated'
    const subdir = path.join(dir, sessionId, 'subagents')
    fs.mkdirSync(subdir, { recursive: true })
    fs.writeFileSync(path.join(subdir, 'agent-a.jsonl'), 'agent-a content')
    fs.writeFileSync(path.join(subdir, 'agent-b.jsonl'), 'agent-b longer content!')
    const before = await childFingerprint(dir, sessionId)

    // Touch one child's content (and therefore size/mtime).
    fs.appendFileSync(path.join(subdir, 'agent-a.jsonl'), 'more')
    const after = await childFingerprint(dir, sessionId)

    expect(after).not.toBe(before)
  })

  it('ignores non-.jsonl files in the subagents directory', async () => {
    const sessionId = 'session-with-junk'
    const subdir = path.join(dir, sessionId, 'subagents')
    fs.mkdirSync(subdir, { recursive: true })
    fs.writeFileSync(path.join(subdir, 'agent-a.jsonl'), 'agent-a content')
    fs.writeFileSync(path.join(subdir, 'agent-b.jsonl'), 'agent-b longer content!')
    const before = await childFingerprint(dir, sessionId)

    fs.writeFileSync(path.join(subdir, '.DS_Store'), 'junk')
    const after = await childFingerprint(dir, sessionId)

    expect(after).toBe(before)
  })
})
