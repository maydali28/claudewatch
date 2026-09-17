import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc/channels'
import {
  UPDATE_WINDOW_WIDTH,
  UPDATE_WINDOW_MIN_HEIGHT,
  UPDATE_WINDOW_MAX_HEIGHT,
} from '@shared/utils/update-window-size'

// updates:resize-window must clamp the renderer's measurement again (never
// trust the renderer), only act when the sender is the live update window
// (never let some other surface resize it), and reject a malformed payload
// via the shared `validate` helper like every other handler.

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()

const mockFromWebContents = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
  },
  BrowserWindow: {
    fromWebContents: (sender: unknown) => mockFromWebContents(sender),
  },
}))

vi.mock('@main/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  rootLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockCaptureHandlerException = vi.fn()
vi.mock('@main/services/sentry', () => ({
  captureHandlerException: (...args: unknown[]) => mockCaptureHandlerException(...args),
}))

vi.mock('@main/services/update-service', () => ({
  checkForUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
}))

const mockGetUpdateWindow = vi.fn()
const mockCenterUpdateWindowOnFirstResize = vi.fn()
vi.mock('@main/window-manager', () => ({
  getUpdateWindow: () => mockGetUpdateWindow(),
  centerUpdateWindowOnFirstResize: (...args: unknown[]) =>
    mockCenterUpdateWindowOnFirstResize(...args),
}))

function makeFakeWindow(): {
  isDestroyed: () => boolean
  setContentSize: ReturnType<typeof vi.fn>
} {
  return { isDestroyed: () => false, setContentSize: vi.fn() }
}

beforeEach(async () => {
  vi.clearAllMocks()
  handlers.clear()
  vi.resetModules()
  const { registerUpdateHandlers } = await import('./update.handlers')
  registerUpdateHandlers()
})

async function callResize(payload: unknown, sender: unknown = {}): Promise<unknown> {
  const handler = handlers.get(CHANNELS.UPDATES_RESIZE_WINDOW)
  if (!handler) throw new Error('updates:resize-window handler was not registered')
  return handler({ sender }, payload)
}

describe('updates:resize-window', () => {
  it('clamps the requested height and resizes the update window', async () => {
    const fakeWindow = makeFakeWindow()
    mockFromWebContents.mockReturnValue(fakeWindow)
    mockGetUpdateWindow.mockReturnValue(fakeWindow)

    const result = await callResize({ height: 5000 })

    expect(fakeWindow.setContentSize).toHaveBeenCalledWith(
      UPDATE_WINDOW_WIDTH,
      UPDATE_WINDOW_MAX_HEIGHT,
      true
    )
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('clamps a too-small height up to the minimum', async () => {
    const fakeWindow = makeFakeWindow()
    mockFromWebContents.mockReturnValue(fakeWindow)
    mockGetUpdateWindow.mockReturnValue(fakeWindow)

    await callResize({ height: 10 })

    expect(fakeWindow.setContentSize).toHaveBeenCalledWith(
      UPDATE_WINDOW_WIDTH,
      UPDATE_WINDOW_MIN_HEIGHT,
      true
    )
  })

  it('ignores a sender that is not the live update window', async () => {
    const fakeWindow = makeFakeWindow()
    const otherWindow = makeFakeWindow()
    mockFromWebContents.mockReturnValue(otherWindow)
    mockGetUpdateWindow.mockReturnValue(fakeWindow)

    const result = await callResize({ height: 400 })

    expect(otherWindow.setContentSize).not.toHaveBeenCalled()
    expect(fakeWindow.setContentSize).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('rejects an invalid payload without reporting it to Sentry', async () => {
    const result = await callResize({ height: 'tall' })

    expect(result).toMatchObject({ ok: false, code: 'UPDATE_RESIZE_FAILED' })
    // A renderer that measures itself wrong is not a crash worth a Sentry
    // event. Failures go through `captureHandlerException`, which returns
    // without capturing when the message starts with this exact prefix (see
    // sentry.ts). Pin the prefix on this side too: rename it on either side
    // and every malformed resize starts filling the issue stream again.
    expect(mockCaptureHandlerException).toHaveBeenCalledTimes(1)
    const [captured] = mockCaptureHandlerException.mock.calls[0] as [unknown]
    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).message).toMatch(/^IPC validation failed/)
  })

  it('rejects a negative height', async () => {
    const result = await callResize({ height: -1 })

    expect(result).toMatchObject({ ok: false, code: 'UPDATE_RESIZE_FAILED' })
  })
})
