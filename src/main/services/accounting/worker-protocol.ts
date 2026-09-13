import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import type { SessionSummary } from '@shared/types/session'
import type { Project } from '@shared/types/project'

/**
 * Messages exchanged with the accounting worker.
 *
 * Kept deliberately small: the worker returns finished summaries, never raw
 * records or parsed transcripts. Shipping whole transcripts across the thread
 * boundary would spend in structured-clone what the worker saves in parsing.
 */

export type PricingTable = Record<ModelFamily, ModelPricing>

export interface ScanProjectsRequest {
  kind: 'scanProjects'
  pricingTable: PricingTable
}

export interface ParseSessionRequest {
  kind: 'parseSession'
  filePath: string
  sessionId: string
  projectId: string
  pricingTable: PricingTable
}

export type WorkerRequest = (ScanProjectsRequest | ParseSessionRequest) & { id: number }

/**
 * `Omit` over a union collapses it to the keys the members share, which would
 * erase every request-specific field. Distributing keeps each variant intact.
 */
export type WorkerRequestPayload = WorkerRequest extends infer T
  ? T extends WorkerRequest
    ? Omit<T, 'id'>
    : never
  : never

export interface ScanProjectsResult {
  projects: Project[]
}

export type WorkerResponse =
  { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string }

/** Narrow a response payload to the result type its request produces. */
export interface ResultFor {
  scanProjects: ScanProjectsResult
  parseSession: SessionSummary
}
