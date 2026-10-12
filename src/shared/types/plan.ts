// ─── Plans ────────────────────────────────────────────────────────────────────

export interface PlanProjectRef {
  projectId: string
  projectName: string
}

export interface PlanSummary {
  id: string // absolute file path — unique across directories
  filename: string
  title: string
  directory: string // absolute directory the plan was found in
  scope: 'default' | 'project'
  projectId?: string
  projectName?: string
  createdAt?: string // ISO date string
  sizeBytes: number
  /**
   * Shared-folder plans only (`scope: 'default'`): the projects whose
   * sessions used this plan. Empty when no scanned session did.
   */
  usedBy?: PlanProjectRef[]
}

export interface PlanDetail {
  id: string
  filename: string
  title: string
  content: string // raw markdown
  directory: string
}
