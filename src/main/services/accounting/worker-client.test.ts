import { describe, expect, it, vi, beforeEach } from 'vitest'
import type * as WorkerThreads from 'worker_threads'

// electron-log's initialize() needs an Electron runtime; the logger module
// calls it at import time.
vi.mock('electron-log', () => ({
  default: {
    initialize: () => {},
    transports: { file: { maxSize: 0 } },
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}))

// Fix round 1, finding 1: `worker_threads` do not share module state, so the
// worker's own `@main/lib/claude-paths` import would otherwise resolve the
// Claude directory independently of the main thread — see
// `seedClaudeDir()`'s doc comment. This mocks the real `Worker` constructor
// (used only by `defaultSpawn`, never by the tests above that inject their
// own `spawn`) so a test can inspect exactly what `workerData` a real spawn
// sends, including on a respawn after a crash.
vi.mock('worker_threads', async (importOriginal) => {
  // `@main/lib/logger` (pulled in transitively via `worker-client.ts`) reads
  // `isMainThread` at import time, so the real module's other exports must
  // survive alongside the faked `Worker`.
  const actual = await importOriginal<typeof WorkerThreads>()
  class FakeThreadWorker {
    static instances: FakeThreadWorker[] = []
    options: { workerData: Record<string, unknown> }
    private handlers = new Map<string, Array<(arg: unknown) => void>>()
    constructor(
      public filename: string,
      options: { workerData: Record<string, unknown> }
    ) {
      this.options = options
      FakeThreadWorker.instances.push(this)
    }
    postMessage(): void {}
    on(event: string, handler: (arg: unknown) => void): void {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
    }
    emit(event: string, arg?: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(arg)
    }
    terminate(): Promise<number> {
      return Promise.resolve(0)
    }
  }
  return { ...actual, Worker: FakeThreadWorker }
})

vi.mock('electron', () => ({
  app: { getPath: () => '/fake/userData' },
}))

const claudePathsMock = vi.hoisted(() => ({
  claudeDir: '/fake/.claude-work' as string,
  source: 'env' as 'env' | 'user-settings' | 'default',
}))
vi.mock('@main/lib/claude-paths', () => ({
  getClaudeDir: () => claudePathsMock.claudeDir,
  getClaudeDirSource: () => claudePathsMock.source,
}))

import { AccountingWorkerClient, type WorkerLike } from './worker-client'
import { Worker as MockedWorkerCtor } from 'worker_threads'
import type { WorkerRequest, WorkerRequestPayload, WorkerResponse } from './worker-protocol'

/** The static instance list on the mocked `worker_threads.Worker` above. */
type FakeThreadWorkerInstance = {
  filename: string
  options: { workerData: Record<string, unknown> }
  emit: (event: string, arg?: unknown) => void
}
const fakeThreadWorkerCtor = MockedWorkerCtor as unknown as {
  instances: FakeThreadWorkerInstance[]
}

/**
 * A stand-in for the real thread. Records what was posted and lets a test
 * deliver replies, exits and errors on demand, so request correlation and
 * lifecycle can be exercised without spawning anything.
 */
class FakeWorker implements WorkerLike {
  posted: WorkerRequest[] = []
  terminated = false
  private handlers = new Map<string, Array<(arg: never) => void>>()

  postMessage(message: WorkerRequest): void {
    this.posted.push(message)
  }

  on(event: string, handler: (arg: never) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  async terminate(): Promise<number> {
    this.terminated = true
    return 0
  }

  emit(event: string, arg?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      ;(handler as (a: unknown) => void)(arg)
    }
  }

  reply(response: WorkerResponse): void {
    this.emit('message', response)
  }

  /** Reply successfully to the nth request posted. */
  replyTo(index: number, data: unknown): void {
    this.reply({ id: this.posted[index].id, ok: true, data })
  }
}

function makeClient(): { client: AccountingWorkerClient; workers: FakeWorker[] } {
  const workers: FakeWorker[] = []
  const client = new AccountingWorkerClient(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  return { client, workers }
}

const SCAN: WorkerRequestPayload = { kind: 'scanProjects', pricingTable: {} as never }

describe('AccountingWorkerClient — request correlation', () => {
  it('resolves a request with the matching reply', async () => {
    const { client, workers } = makeClient()

    const pending = client.request(SCAN)
    workers[0].replyTo(0, { projects: [] })

    await expect(pending).resolves.toEqual({ projects: [] })
  })

  it('routes concurrent replies to their own callers, whatever the order', async () => {
    const { client, workers } = makeClient()

    const first = client.request(SCAN)
    const second = client.request(SCAN)
    // Reply out of order: the second request answered before the first.
    workers[0].replyTo(1, 'second')
    workers[0].replyTo(0, 'first')

    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
  })

  it('rejects when the worker reports failure', async () => {
    const { client, workers } = makeClient()

    const pending = client.request(SCAN)
    workers[0].reply({ id: workers[0].posted[0].id, ok: false, error: 'parse exploded' })

    await expect(pending).rejects.toThrow('parse exploded')
  })

  it('ignores a reply whose id matches nothing', async () => {
    const { client, workers } = makeClient()

    const pending = client.request(SCAN)
    workers[0].reply({ id: 9999, ok: true, data: 'stray' })
    workers[0].replyTo(0, 'real')

    await expect(pending).resolves.toBe('real')
  })

  it('starts exactly one worker for many requests', async () => {
    const { client, workers } = makeClient()

    const a = client.request(SCAN)
    const b = client.request(SCAN)
    workers[0].replyTo(0, 1)
    workers[0].replyTo(1, 2)
    await Promise.all([a, b])

    expect(workers).toHaveLength(1)
  })
})

/**
 * The ledger is fully derivable from the transcripts, so a dead worker costs a
 * rebuild and nothing else. What must not happen is a caller hanging forever on
 * a reply that can no longer arrive.
 */
describe('AccountingWorkerClient — lifecycle', () => {
  it('rejects in-flight requests when the worker exits', async () => {
    const { client, workers } = makeClient()

    const pending = client.request(SCAN)
    workers[0].emit('exit', 1)

    await expect(pending).rejects.toThrow(/exited/i)
  })

  it('rejects in-flight requests when the worker errors', async () => {
    const { client, workers } = makeClient()

    const pending = client.request(SCAN)
    workers[0].emit('error', new Error('boom'))

    await expect(pending).rejects.toThrow('boom')
  })

  it('starts a fresh worker for the next request after a crash', async () => {
    const { client, workers } = makeClient()

    const crashed = client.request(SCAN)
    workers[0].emit('exit', 1)
    await expect(crashed).rejects.toThrow()

    const retried = client.request(SCAN)
    workers[1].replyTo(0, 'recovered')

    await expect(retried).resolves.toBe('recovered')
    expect(workers).toHaveLength(2)
  })

  it('terminates the underlying worker on dispose', async () => {
    const { client, workers } = makeClient()

    const pending = client.request(SCAN)
    workers[0].replyTo(0, null)
    await pending
    await client.dispose()

    expect(workers[0].terminated).toBe(true)
  })

  it('rejects in-flight requests on dispose rather than leaving them hanging', async () => {
    const { client, workers } = makeClient()

    const pending = client.request(SCAN)
    await client.dispose()

    await expect(pending).rejects.toThrow(/shut down/i)
    expect(workers[0].terminated).toBe(true)
  })
})

/**
 * Fix round 1, finding 1: exercises the REAL `defaultSpawn()` (no injected
 * `spawn`), which is the only place `workerData` is actually built — the
 * `makeClient()` tests above bypass it entirely. Confirms the worker gets
 * the main thread's already-resolved Claude dir/source, on the first spawn
 * and on a respawn after a crash (a stale first-spawn value silently
 * surviving a respawn is exactly the bug this exists to catch).
 */
describe('AccountingWorkerClient — default spawn carries the resolved Claude dir', () => {
  beforeEach(() => {
    fakeThreadWorkerCtor.instances.length = 0
    claudePathsMock.claudeDir = '/fake/.claude-work'
    claudePathsMock.source = 'env'
  })

  it("passes the main thread's resolved claudeDir and claudeDirSource in workerData on the first spawn", () => {
    const client = new AccountingWorkerClient()

    void client.request(SCAN).catch(() => undefined)

    expect(fakeThreadWorkerCtor.instances).toHaveLength(1)
    expect(fakeThreadWorkerCtor.instances[0].options.workerData).toMatchObject({
      claudeDir: '/fake/.claude-work',
      claudeDirSource: 'env',
    })
  })

  it("passes a freshly-resolved dir/source on a respawn after a crash, not the first spawn's stale value", () => {
    const client = new AccountingWorkerClient()
    void client.request(SCAN).catch(() => undefined)
    expect(fakeThreadWorkerCtor.instances).toHaveLength(1)

    // Simulates the resolution changing between the first spawn and the
    // respawn — e.g. the worker crashed after the user-settings override
    // changed underneath it.
    claudePathsMock.claudeDir = '/fake/.claude-relocated'
    claudePathsMock.source = 'user-settings'
    fakeThreadWorkerCtor.instances[0].emit('exit', 1)

    void client.request(SCAN).catch(() => undefined)

    expect(fakeThreadWorkerCtor.instances).toHaveLength(2)
    expect(fakeThreadWorkerCtor.instances[1].options.workerData).toMatchObject({
      claudeDir: '/fake/.claude-relocated',
      claudeDirSource: 'user-settings',
    })
  })
})
