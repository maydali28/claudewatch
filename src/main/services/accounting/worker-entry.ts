import { parentPort, workerData } from 'worker_threads'
import { scanProjects } from '@main/services/project-scanner'
import { parseSessionMetadata } from '@main/services/parsers/metadata-parser'
import { configureMetadataCacheDir } from '@main/services/metadata-cache'
import type { WorkerRequest, WorkerResponse } from './worker-protocol'

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
