import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReparseScheduler } from './reparse-scheduler'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const DEBOUNCE = 300

describe('ReparseScheduler — debounce', () => {
  it('runs once for a burst of changes to the same file', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    scheduler.schedule('a.jsonl')
    scheduler.schedule('a.jsonl')
    scheduler.schedule('a.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps separate files independent', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    scheduler.schedule('a.jsonl')
    scheduler.schedule('b.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(run.mock.calls.map((c) => c[0]).sort()).toEqual(['a.jsonl', 'b.jsonl'])
  })
})

/**
 * The watcher used to drop any event that arrived while a parse of that file was
 * running. A session streaming a long turn writes continuously, so the last
 * writes during a parse were lost and the session sat stale until something
 * else touched it.
 */
describe('ReparseScheduler — changes during an in-flight parse', () => {
  it('re-runs once after a change that arrives mid-parse', async () => {
    let release: () => void = () => {}
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    scheduler.schedule('a.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(run).toHaveBeenCalledTimes(1)

    // Two more writes land while the first parse is still running.
    scheduler.schedule('a.jsonl')
    scheduler.schedule('a.jsonl')
    expect(run).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    // Exactly one catch-up, not one per dropped event.
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not re-run when nothing changed during the parse', async () => {
    let release: () => void = () => {}
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    scheduler.schedule('a.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    release()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('still catches up when the parse fails', async () => {
    let reject: (e: Error) => void = () => {}
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, rej) => {
            reject = rej
          })
      )
      .mockResolvedValue(undefined)
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    scheduler.schedule('a.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    scheduler.schedule('a.jsonl')

    reject(new Error('parse blew up'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(run).toHaveBeenCalledTimes(2)
  })
})

/**
 * `schedule` fires the parse without awaiting it, so a rejection thrown by the
 * parse had nowhere to land. Node terminates the process on an unhandled
 * rejection by default, meaning one unreadable transcript could take the whole
 * main process down with it.
 */
describe('ReparseScheduler — parse failures', () => {
  it('reports a failed parse rather than leaving the rejection unhandled', async () => {
    const boom = new Error('parse blew up')
    const run = vi.fn().mockRejectedValue(boom)
    const onError = vi.fn()
    const scheduler = new ReparseScheduler(run, DEBOUNCE, onError)

    scheduler.schedule('a.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(onError).toHaveBeenCalledWith('a.jsonl', boom)
  })

  it('keeps scheduling that file after a failure', async () => {
    const run = vi.fn().mockRejectedValue(new Error('parse blew up'))
    const scheduler = new ReparseScheduler(run, DEBOUNCE, vi.fn())

    scheduler.schedule('a.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    scheduler.schedule('a.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('ReparseScheduler — stop', () => {
  it('cancels pending work', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    scheduler.schedule('a.jsonl')
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2)

    expect(run).not.toHaveBeenCalled()
  })
})
