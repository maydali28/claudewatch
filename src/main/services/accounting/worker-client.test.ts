import { describe, expect, it, vi } from 'vitest'

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

import { AccountingWorkerClient, type WorkerLike } from './worker-client'
import type { WorkerRequest, WorkerRequestPayload, WorkerResponse } from './worker-protocol'

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
