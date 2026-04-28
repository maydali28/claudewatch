// ─── Plans ────────────────────────────────────────────────────────────────────

export interface PlanSummary {
  id: string // filename (unique)
  filename: string
  title: string
  projectHint?: string
  createdAt?: string // ISO date string
  sizeBytes: number
}

export interface PlanDetail {
  filename: string
  title: string
  content: string // raw markdown
}
