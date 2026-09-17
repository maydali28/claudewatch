import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc/channels'

// While a restart is pending after crash reports were switched on, the
// feedback form is shown (the preference is on) but the SDK is not running.
// `captureUserFeedback` returned silently in that state, the handler answered
// ok, and the form said "Feedback sent" for a message that went nowhere.

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
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

const mockCaptureUserFeedback = vi.fn<(...args: unknown[]) => boolean>()
const mockCaptureHandlerException = vi.fn()
vi.mock('@main/services/sentry', () => ({
  captureUserFeedback: (...args: unknown[]) => mockCaptureUserFeedback(...args),
  captureHandlerException: (...args: unknown[]) => mockCaptureHandlerException(...args),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  handlers.clear()
  vi.resetModules()
  const { registerFeedbackHandlers } = await import('./feedback.handlers')
  registerFeedbackHandlers()
})

async function submit(payload: unknown): Promise<unknown> {
  const handler = handlers.get(CHANNELS.FEEDBACK_SUBMIT)
  if (!handler) throw new Error('feedback:submit handler was not registered')
  return handler({}, payload)
}

const payload = { name: 'Alice', email: 'alice@example.com', message: 'Great app' }

describe('feedback:submit', () => {
  it('answers ok when the feedback was handed to Sentry', async () => {
    mockCaptureUserFeedback.mockReturnValue(true)

    await expect(submit(payload)).resolves.toEqual({ ok: true, data: undefined })
    expect(mockCaptureUserFeedback).toHaveBeenCalledWith(payload)
  })

  it('tells the user to restart when the feedback could not be sent', async () => {
    mockCaptureUserFeedback.mockReturnValue(false)

    await expect(submit(payload)).resolves.toMatchObject({
      ok: false,
      error: 'Restart ClaudeWatch to send feedback.',
    })
    // An expected state, not a crash.
    expect(mockCaptureHandlerException).not.toHaveBeenCalled()
  })
})
