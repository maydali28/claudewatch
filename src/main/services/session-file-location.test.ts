import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { resolveSessionFileLocation } from './session-file-location'

const PROJECTS = path.join('/home', 'me', '.claude', 'projects')
const p = (...parts: string[]): string => path.join(PROJECTS, ...parts)

describe('resolveSessionFileLocation — parent transcripts', () => {
  it('resolves a session file', () => {
    expect(resolveSessionFileLocation(p('-Users-me-proj', 'sess-1.jsonl'), PROJECTS)).toEqual({
      projectId: '-Users-me-proj',
      sessionId: 'sess-1',
      isSubagent: false,
    })
  })
})

/**
 * Subagent transcripts live at `<project>/<session>/subagents/agent-*.jsonl`.
 * The resolver required exactly two path components, so every subagent write
 * was discarded — a session's child spend stayed invisible until a full rescan,
 * and the disk cache's parent-only fingerprint meant a restart did not fix it.
 *
 * A child change maps to its parent session, because the parent's summary is
 * what rolls the child's usage up.
 */
describe('resolveSessionFileLocation — subagent transcripts', () => {
  it('maps a subagent file to its parent session', () => {
    expect(
      resolveSessionFileLocation(
        p('-Users-me-proj', 'sess-1', 'subagents', 'agent-abc123.jsonl'),
        PROJECTS
      )
    ).toEqual({
      projectId: '-Users-me-proj',
      sessionId: 'sess-1',
      isSubagent: true,
    })
  })
})

describe('resolveSessionFileLocation — paths it must reject', () => {
  it('rejects a file directly in the projects directory', () => {
    expect(resolveSessionFileLocation(p('stray.jsonl'), PROJECTS)).toBeNull()
  })

  it('rejects a path outside the projects directory', () => {
    expect(resolveSessionFileLocation('/etc/passwd.jsonl', PROJECTS)).toBeNull()
  })

  it('rejects an unrelated nested file', () => {
    expect(
      resolveSessionFileLocation(p('-Users-me-proj', 'sess-1', 'notes', 'x.jsonl'), PROJECTS)
    ).toBeNull()
  })

  it('rejects a deeper path than a subagent transcript', () => {
    expect(
      resolveSessionFileLocation(
        p('-Users-me-proj', 'sess-1', 'subagents', 'nested', 'agent-x.jsonl'),
        PROJECTS
      )
    ).toBeNull()
  })
})
