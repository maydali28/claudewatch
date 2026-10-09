import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dirs = vi.hoisted(() => ({ projects: '' }))
vi.mock('@main/lib/claude-paths', () => ({ getProjectsDirPath: () => dirs.projects }))

import { readTranscriptMcpInfo, readTranscriptMcpStatuses } from './mcp-status'

function delta(
  timestamp: string,
  attachment: Record<string, unknown>,
  type = 'deferred_tools_delta'
): string {
  return JSON.stringify({ type: 'attachment', timestamp, attachment: { type, ...attachment } })
}

function writeTranscript(project: string, id: string, lines: string[], mtime: number): void {
  const file = path.join(dirs.projects, project, `${id}.jsonl`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.join('\n') + '\n')
  fs.utimesSync(file, mtime, mtime)
}

beforeEach(() => {
  dirs.projects = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'))
})

afterEach(() => {
  fs.rmSync(dirs.projects, { recursive: true, force: true })
})

describe('readTranscriptMcpStatuses', () => {
  it('reads connected, needs-auth and failed servers, keyed by tool-name form', async () => {
    writeTranscript(
      '-p',
      's1',
      [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        delta('2026-10-08T10:00:00.000Z', {
          addedNames: [
            'Read',
            'mcp__github__get_me',
            'mcp__github__list_issues',
            'mcp__claude_ai_Sentry__x',
          ],
          needsAuthMcpServers: ['claude.ai Gmail'],
          failedMcpServers: [
            { name: 'memcp', errorCode: 'CONNECTION_CLOSED', error: 'Connection closed' },
          ],
        }),
        '{"type":"attachment","timestamp":"2026-10-08T10', // a half-written last line
      ],
      1000
    )

    const statuses = await readTranscriptMcpStatuses()
    expect(statuses.get('github')).toEqual({
      status: 'connected',
      toolCount: 2,
      tools: ['get_me', 'list_issues'],
      lastSeen: '2026-10-08T10:00:00.000Z',
    })
    expect(statuses.get('claude_ai_Sentry')?.status).toBe('connected')
    expect(statuses.get('claude_ai_Gmail')?.status).toBe('needs-auth')
    expect(statuses.get('memcp')).toMatchObject({ status: 'failed', error: 'Connection closed' })
  })

  it('keeps the most recent status across sessions', async () => {
    writeTranscript(
      '-a',
      'old',
      [delta('2026-10-01T00:00:00.000Z', { addedNames: ['mcp__memcp__recall'] })],
      2000
    )
    writeTranscript(
      '-b',
      'new',
      [delta('2026-10-08T00:00:00.000Z', { failedMcpServers: [{ name: 'memcp', error: 'boom' }] })],
      3000
    )
    expect((await readTranscriptMcpStatuses()).get('memcp')).toMatchObject({
      status: 'failed',
      error: 'boom',
    })
  })

  it('reads only the most recently written transcripts', async () => {
    writeTranscript(
      '-a',
      'stale',
      [delta('2026-09-01T00:00:00.000Z', { addedNames: ['mcp__old__x'] })],
      1000
    )
    writeTranscript(
      '-a',
      'fresh',
      [delta('2026-10-01T00:00:00.000Z', { addedNames: ['mcp__new__x'] })],
      5000
    )
    const statuses = await readTranscriptMcpStatuses(1)
    expect([...statuses.keys()]).toEqual(['new'])
  })

  it('adds up tools announced in several records of one session', async () => {
    writeTranscript(
      '-p',
      's1',
      [
        delta('2026-10-08T10:00:00.000Z', { addedNames: ['mcp__gh__b', 'mcp__gh__a'] }),
        delta('2026-10-08T10:05:00.000Z', { addedNames: ['mcp__gh__c'] }),
      ],
      1000
    )
    expect((await readTranscriptMcpStatuses()).get('gh')).toMatchObject({
      toolCount: 3,
      tools: ['a', 'b', 'c'],
      lastSeen: '2026-10-08T10:05:00.000Z',
    })
  })

  it('reads server instructions without their heading', async () => {
    writeTranscript(
      '-p',
      's1',
      [
        delta(
          '2026-10-08T10:00:00.000Z',
          {
            addedNames: ['github', 'claude.ai Claude Docs'],
            addedBlocks: ['## github\nUse list_* tools.', '## claude.ai Claude Docs\nDocs here.'],
          },
          'mcp_instructions_delta'
        ),
      ],
      1000
    )
    const { instructions } = await readTranscriptMcpInfo()
    expect(instructions.get('github')).toBe('Use list_* tools.')
    expect(instructions.get('claude_ai_Claude_Docs')).toBe('Docs here.')
  })

  it('returns nothing when there is no projects folder', async () => {
    dirs.projects = path.join(dirs.projects, 'missing')
    expect((await readTranscriptMcpStatuses()).size).toBe(0)
  })
})
