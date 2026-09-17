import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc/channels'
import type { ClaudeDirSource } from '@main/lib/claude-paths'

// Same handler-capture approach as settings.handlers.test.ts: `ipcMain.handle`
// is mocked to record each registered handler by channel, so a test can call
// it directly without spinning up a real Electron main process.
const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  app: {
    getVersion: () => '1.5.0',
  },
}))

const mockGetClaudeDir = vi.fn(() => '/home/fixture/.claude')
const mockGetClaudeDirSource = vi.fn<() => ClaudeDirSource>(() => 'default')
const mockDescribeClaudeDir = vi.fn(() => '~/.claude')
vi.mock('@main/lib/claude-paths', () => ({
  getClaudeDir: () => mockGetClaudeDir(),
  getClaudeDirSource: () => mockGetClaudeDirSource(),
  describeClaudeDir: () => mockDescribeClaudeDir(),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  mockGetClaudeDir.mockReturnValue('/home/fixture/.claude')
  mockGetClaudeDirSource.mockReturnValue('default')
  mockDescribeClaudeDir.mockReturnValue('~/.claude')
  handlers.clear()
  vi.resetModules()
  const { registerAppHandlers } = await import('./app.handlers')
  registerAppHandlers()
})

async function callGetPaths(): Promise<unknown> {
  const handler = handlers.get(CHANNELS.APP_GET_PATHS)
  if (!handler) throw new Error('app:get-paths handler was not registered')
  return handler(undefined, undefined)
}

describe('app:get-paths', () => {
  it('reports the resolved Claude dir, its display form, and its source', async () => {
    const result = await callGetPaths()

    expect(result).toEqual({
      ok: true,
      data: { claudeDir: '/home/fixture/.claude', display: '~/.claude', source: 'default' },
    })
  })

  it('reflects an env override in both the path and the source', async () => {
    mockGetClaudeDir.mockReturnValue('/home/fixture/.claude-work')
    mockGetClaudeDirSource.mockReturnValue('env')
    mockDescribeClaudeDir.mockReturnValue('~/.claude-work')

    const result = await callGetPaths()

    expect(result).toEqual({
      ok: true,
      data: { claudeDir: '/home/fixture/.claude-work', display: '~/.claude-work', source: 'env' },
    })
  })
})
