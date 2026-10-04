import type { LintCheckId, LintSeverity } from './lint'

/**
 * A secret found in a transcript. Never holds the secret itself: only its
 * masked form and a one-way fingerprint, so the same secret in the same
 * session is reported once.
 */
export interface SecretFindingRecord {
  /** `fingerprint` + session, unique in the store. */
  id: string
  /** Check id plus a SHA-256 prefix of the value; cannot be turned back into it. */
  fingerprint: string
  checkId: LintCheckId
  severity: LintSeverity
  /** "API Key/Token", "Private Key", … */
  patternName: string
  /** First and last four characters, e.g. `ghp_****Ab7c`. */
  maskedValue: string
  projectId: string
  sessionId: string
  /** Set when the secret is in a sub-agent's transcript. */
  agentId?: string
  /** 1-based line in the transcript, when the whole file was read. */
  lineNumber?: number
  /** When Claude Code wrote the record that holds it, if it says. */
  occurredAt?: string
  /** When ClaudeWatch found it. */
  foundAt: string
  /** Found as it was written, or by a scan of older transcripts. */
  source: 'live' | 'history'
  dismissed: boolean
}

export interface SecretHistoryScanResult {
  filesScanned: number
  /** Findings not already in the list. */
  newFindings: number
  durationMs: number
}
