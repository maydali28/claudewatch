import * as fs from 'fs'
import * as path from 'path'
import { parentPort, workerData } from 'worker_threads'
import { scanProjects } from '@main/services/project-scanner'
import { parseSessionMetadata } from '@main/services/parsers/metadata-parser'
import { childFingerprint } from '@main/services/parsers/child-fingerprint'
import { configureMetadataCacheDir, setCachedSummary } from '@main/services/metadata-cache'
import { pricingFingerprint } from '@main/services/pricing-engine'
import { currentTimezone } from '@shared/utils/date-ranges'
import { createLogger } from '@main/lib/logger'
import type { WorkerRequest, WorkerResponse } from './worker-protocol'

const log = createLogger('AccountingWorker')

export interface AccountingWorkerData {
  /** Electron's userData directory, resolved by main — `app` is unavailable here. */
  userDataPath: string
}

/**
 * The accounting worker.
 *
 * Owns every transcript read and every token added up. Runs off the main
 * thread because a cold scan of the full history costs ~1.1s and a single
 * large transcript ~40ms — time Electron would otherwise not be spending on
 * windows, input or IPC.
 *
 * It holds no state between requests: the caller supplies the pricing table,
 * and the ledger is derivable from the transcripts, so a crash costs a rebuild
 * rather than lost data. That is what lets the client simply restart it.
 */

export async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    switch (request.kind) {
      case 'scanProjects': {
        const projects = await scanProjects(request.pricingTable)
        return { id: request.id, ok: true, data: projects }
      }
      case 'parseSession': {
        const summary = await parseSessionMetadata(
          request.filePath,
          request.sessionId,
          request.projectId,
          request.pricingTable
        )
        // Write the fresh summary back into the same disk cache discovery
        // reads, keyed the same way it would key it — otherwise a
        // watcher-driven re-parse (this call) produces the right numbers in
        // memory, but the next cold scan reads the stale entry right back off
        // disk. Best-effort: a failed write-through must not fail the parse
        // that the caller is waiting on.
        try {
          const stat = await fs.promises.stat(request.filePath)
          const childFp = await childFingerprint(path.dirname(request.filePath), request.sessionId)
          // Same table this request priced `summary` with, passed explicitly
          // (not via shared module state — this request can be interleaved
          // with a concurrent scanProjects for a different table) so the
          // write-through lands stamped with the fingerprint a later
          // scanProjects() will actually expect.
          setCachedSummary(
            request.filePath,
            stat.mtimeMs,
            stat.size,
            childFp,
            pricingFingerprint(request.pricingTable),
            currentTimezone(),
            summary
          )
        } catch (error) {
          log.warn('Failed to refresh metadata cache after live re-parse:', error)
        }
        return { id: request.id, ok: true, data: summary }
      }
    }
  } catch (error) {
    // Errors cannot cross a thread boundary intact, so send the message and let
    // the client rebuild an Error from it.
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

if (parentPort) {
  const port = parentPort
  const data = workerData as AccountingWorkerData | null
  if (data?.userDataPath) configureMetadataCacheDir(data.userDataPath)
  port.on('message', (request: WorkerRequest) => {
    void handleRequest(request).then((response) => port.postMessage(response))
  })
}
