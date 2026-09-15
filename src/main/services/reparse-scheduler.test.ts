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

  it('prevents a queued burst across children of one parent from ever running', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    for (let i = 0; i < 5; i++) {
      scheduler.schedule(`/p/sess/subagents/agent-${i}.jsonl`, '/p/sess.jsonl')
    }
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2)

    expect(run).not.toHaveBeenCalled()
  })
})

/**
 * The parent's summary rolls up every child's usage, so it cannot be computed
 * from a child alone — every execution re-parses the parent AND all of its
 * children regardless of which single file triggered it. Measured cost: a
 * median of 6ms, but 152ms for the largest session (83 children). Keying the
 * queue by the changed file meant a burst across those children queued up to
 * 83 redundant full parses of the same data — about 12 seconds of wasted work
 * for one logical change. Keying by parent instead collapses that burst into
 * one job, plus at most one trailing re-run for events that land mid-parse.
 */
describe('ReparseScheduler — parent coalescing', () => {
  // drain() polls with real setTimeout; under the file's default fake timers
  // it would spin forever, since nothing advances the fake clock for it.
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst across many subagents into one parent re-parse', async () => {
    const parse = vi.fn().mockResolvedValue(undefined)
    const scheduler = new ReparseScheduler(parse)

    for (let i = 0; i < 20; i++) {
      scheduler.schedule(`/p/sess/subagents/agent-${i}.jsonl`, '/p/sess.jsonl')
    }
    await scheduler.drain()

    // One parse for the burst, plus at most one trailing re-run for events
    // that landed mid-parse.
    expect(parse.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('still parses once per parent when the burst spans different sessions', async () => {
    // A coalescing bug that merged unrelated sessions onto one key would be
    // far worse than the redundant-parse problem this is fixing.
    const parse = vi.fn().mockResolvedValue(undefined)
    const scheduler = new ReparseScheduler(parse, DEBOUNCE)

    for (let i = 0; i < 10; i++) {
      scheduler.schedule(`/p/sess-a/subagents/agent-${i}.jsonl`, '/p/sess-a.jsonl')
    }
    for (let i = 0; i < 10; i++) {
      scheduler.schedule(`/p/sess-b/subagents/agent-${i}.jsonl`, '/p/sess-b.jsonl')
    }
    await scheduler.drain()

    expect(parse.mock.calls.map((c) => c[0]).sort()).toEqual(['/p/sess-a.jsonl', '/p/sess-b.jsonl'])
  })
})

describe("ReparseScheduler — mid-parse burst across a parent's children", () => {
  it('collapses many different children of one parent into a single trailing re-run', async () => {
    let release: () => void = () => {}
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const scheduler = new ReparseScheduler(run, DEBOUNCE)

    scheduler.schedule('/p/sess.jsonl', '/p/sess.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(run).toHaveBeenCalledTimes(1)

    // Ten different children of the same parent write while that parse is
    // still running — not the same file repeated, which the old per-file
    // keying already handled.
    for (let i = 0; i < 10; i++) {
      scheduler.schedule(`/p/sess/subagents/agent-${i}.jsonl`, '/p/sess.jsonl')
    }
    expect(run).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    // Exactly one catch-up, not one per child that wrote mid-parse.
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('still retries after a failed parse, reported against the parent key', async () => {
    const boom = new Error('parse blew up')
    const run = vi.fn().mockRejectedValue(boom)
    const onError = vi.fn()
    const scheduler = new ReparseScheduler(run, DEBOUNCE, onError)

    scheduler.schedule('/p/sess/subagents/agent-0.jsonl', '/p/sess.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    // Reported against the parent, not whichever child happened to trigger
    // it — there is no other identity left once the burst has collapsed.
    expect(onError).toHaveBeenCalledWith('/p/sess.jsonl', boom)

    scheduler.schedule('/p/sess/subagents/agent-1.jsonl', '/p/sess.jsonl')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(run).toHaveBeenCalledTimes(2)
  })
})
