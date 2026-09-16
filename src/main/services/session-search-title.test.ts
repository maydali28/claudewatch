import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Real filesystem and real readline, unlike `session-search.test.ts` which
// mocks both to observe fan-out. This file only cares about what a result
// reports for a session, so it points the projects dir at a temp folder.
let projectsDir: string
vi.mock('@main/lib/claude-paths', () => ({
  getProjectsDirPath: () => projectsDir,
}))

import { searchSessions } from './session-search'

beforeAll(() => {
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-search-title-'))
})

afterAll(() => {
  fs.rmSync(projectsDir, { recursive: true, force: true })
})

function writeSession(projectId: string, sessionId: string, records: unknown[]): void {
  const dir = path.join(projectsDir, projectId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  )
}

const prompt = (text: string, slug?: string): Record<string, unknown> => ({
  type: 'user',
  uuid: `u-${text}`,
  ...(slug ? { slug } : {}),
  message: { role: 'user', content: text },
})

describe('searchSessions — result title', () => {
  it('reports the Claude-generated ai-title, not the slug or id', async () => {
    writeSession('proj-a', 'sess-1', [
      prompt('needle one', 'fluffy-wandering-panda'),
      { type: 'ai-title', sessionId: 'sess-1', aiTitle: 'Needle hunting' },
    ])

    const [result] = await searchSessions({ query: 'needle', projectIds: ['proj-a'] })

    expect(result.sessionTitle).toBe('Needle hunting')
  })

  it('falls back to the slug when there is no ai-title', async () => {
    writeSession('proj-b', 'sess-2', [prompt('needle two', 'fluffy-wandering-panda')])

    const [result] = await searchSessions({ query: 'needle', projectIds: ['proj-b'] })

    expect(result.sessionTitle).toBe('fluffy-wandering-panda')
  })

  it('falls back to the session id when there is neither', async () => {
    writeSession('proj-c', 'sess-3', [prompt('needle three')])

    const [result] = await searchSessions({ query: 'needle', projectIds: ['proj-c'] })

    expect(result.sessionTitle).toBe('sess-3')
  })
})
