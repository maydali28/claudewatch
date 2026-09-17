import * as path from 'path'
import { Worker } from 'worker_threads'
import { app } from 'electron'
import { createLogger } from '@main/lib/logger'
import { getClaudeDir, getClaudeDirSource } from '@main/lib/claude-paths'
import type {
  PricingTable,
  ResultFor,
  WorkerRequest,
  WorkerRequestPayload,
  WorkerResponse,
} from './worker-protocol'

const log = createLogger('AccountingWorker')

/**
 * The slice of `worker_threads.Worker` this client uses. Narrowing it keeps the
 * lifecycle logic — which is where the bugs live — testable without spawning a
 * thread.
 */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void
  on(event: 'message' | 'error' | 'exit', handler: (arg: never) => void): void
  terminate(): Promise<number>
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Runs transcript parsing off the main thread.
 *
 * Parsing the whole history costs ~1.1s and a single large transcript ~40ms;
 * on the main thread that is time Electron cannot spend on windows or IPC. The
 * worker is started lazily on first use and restarted after a crash — the
 * ledger is fully derivable from the transcripts, so a dead worker costs a
 * rebuild and nothing else.
 */
export class AccountingWorkerClient {
  private worker: WorkerLike | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private disposed = false

  constructor(private readonly spawn: () => WorkerLike = defaultSpawn) {}

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker

    const worker = this.spawn()
    worker.on('message', (response: WorkerResponse) => this.settle(response))
    worker.on('error', (error: Error) => this.failAll(error, worker))
    worker.on('exit', (code: number) =>
      this.failAll(new Error(`Accounting worker exited with code ${code}`), worker)
    )
    this.worker = worker
    return worker
  }

  private settle(response: WorkerResponse): void {
    const entry = this.pending.get(response.id)
    // A reply with no waiter is not an error: it can arrive after the caller
    // was already failed by a crash or a dispose.
    if (!entry) return
    this.pending.delete(response.id)
    if (response.ok) entry.resolve(response.data)
    else entry.reject(new Error(response.error))
  }

  private failAll(error: Error, from: WorkerLike): void {
    // Ignore events from a worker we have already replaced.
    if (this.worker !== from) return
    this.worker = null
    if (this.pending.size > 0) {
      log.error('Worker died with %d request(s) in flight:', this.pending.size, error.message)
    }
    for (const [, entry] of this.pending) entry.reject(error)
    this.pending.clear()
  }

  /** Low-level send. Prefer the typed wrappers below. */
  request<T = unknown>(payload: WorkerRequestPayload): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Accounting worker was shut down'))

    const id = this.nextId++
    const worker = this.ensureWorker()

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        worker.postMessage({ ...payload, id } as WorkerRequest)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  scanProjects(pricingTable: PricingTable): Promise<ResultFor['scanProjects']> {
    return this.request<ResultFor['scanProjects']>({ kind: 'scanProjects', pricingTable })
  }

  parseSession(
    filePath: string,
    sessionId: string,
    projectId: string,
    pricingTable: PricingTable
  ): Promise<ResultFor['parseSession']> {
    return this.request<ResultFor['parseSession']>({
      kind: 'parseSession',
      filePath,
      sessionId,
      projectId,
      pricingTable,
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const worker = this.worker
    this.worker = null
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Accounting worker was shut down'))
    }
    this.pending.clear()
    if (worker) await worker.terminate().catch(() => undefined)
  }
}

function defaultSpawn(): WorkerLike {
  // Sits beside the compiled main entry; electron-vite emits it as a second
  // rollup input, so this resolves in both development and a packaged app.
  // Electron's `app` does not exist inside a worker thread, so the paths it
  // owns are resolved here and handed over at spawn.
  //
  // `worker_threads` do not share module state with this thread, so
  // `@main/lib/claude-paths` inside the worker would otherwise resolve the
  // Claude directory independently of what this thread (and `FileWatcher`)
  // are watching — see `seedClaudeDir()`'s doc comment. Computed fresh on
  // every call, so a respawn after a crash carries this thread's *current*
  // resolution, not whatever the very first spawn saw.
  return new Worker(path.join(__dirname, 'accounting-worker.js'), {
    workerData: {
      userDataPath: app.getPath('userData'),
      claudeDir: getClaudeDir(),
      claudeDirSource: getClaudeDirSource(),
    },
  }) as unknown as WorkerLike
}

export const accountingWorker = new AccountingWorkerClient()
