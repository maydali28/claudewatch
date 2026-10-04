import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import type { SecretFindingRecord, SecretHistoryScanResult } from '@shared/types/secrets'
import { createLineScanner, type SecretFinding } from '@shared/utils/secret-patterns'
import { resolveSessionFileLocation } from './session-file-location'
import type { SecretFindingsStore } from './secret-findings-store'

// Scans transcripts for secrets, with the user's consent. Live scanning reads
// only what was written after it started: every transcript's size is recorded
// when scanning starts, and each change is read from there. History scanning
// reads every transcript still on disk, when asked.

const TIMESTAMP = /"timestamp":"([^"]+)"/
/** Lines read between yields to the event loop during a history scan. */
const YIELD_EVERY_LINES = 2000

export interface SecretScanServiceDeps {
  projectsDir: string
  store: SecretFindingsStore
  /** Whether the user has turned scanning on and consented. */
  isEnabled: () => boolean
  /** Told about findings not seen before. */
  onNewFindings: (findings: SecretFindingRecord[]) => void
  now?: () => Date
}

/** Every transcript under `projectsDir`: sessions and their sub-agents. */
export async function listTranscripts(projectsDir: string): Promise<string[]> {
  const files: string[] = []
  let projects: fs.Dirent[]
  try {
    projects = await fs.promises.readdir(projectsDir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(projectsDir, project.name)
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(projectDir, entry.name))
      } else if (entry.isDirectory()) {
        const subDir = path.join(projectDir, entry.name, 'subagents')
        try {
          for (const sub of await fs.promises.readdir(subDir)) {
            if (sub.endsWith('.jsonl')) files.push(path.join(subDir, sub))
          }
        } catch {
          // Most sessions have no sub-agents.
        }
      }
    }
  }
  return files
}

/**
 * A one-way fingerprint of the secret's value alone, so one key matched by
 * two patterns (an `api_key=` line holding an `sk-ant-` token) is one finding.
 */
export function fingerprintOf(finding: Pick<SecretFinding, 'rawValue'>): string {
  return crypto.createHash('sha256').update(finding.rawValue).digest('hex').slice(0, 16)
}

/**
 * When several patterns match the same value, the most specific one names
 * the finding: a known token format says more than "API key".
 */
const SPECIFICITY: Record<string, number> = {
  SEC001: 0, // private key
  SEC007: 1, // platform token (GitHub, Anthropic, Slack, …)
  SEC002: 2, // AWS access key
  SEC006: 3, // connection string
  SEC003: 4, // authorization header
  SEC004: 5, // api key / token assignment
  SEC005: 6, // password literal
}

export class SecretScanService {
  /** Bytes of each transcript already accounted for. Present only while active. */
  private offsets: Map<string, number> | null = null
  private activating: Promise<void> | null = null

  constructor(private readonly deps: SecretScanServiceDeps) {}

  get active(): boolean {
    return this.offsets !== null
  }

  /**
   * Start or stop live scanning to match the preferences. Starting records
   * every transcript's current size, so content already there is not reported
   * as new.
   */
  async sync(): Promise<void> {
    if (!this.deps.isEnabled()) {
      this.offsets = null
      this.activating = null
      return
    }
    if (this.offsets || this.activating) return this.activating ?? undefined
    this.activating = (async () => {
      const baseline = new Map<string, number>()
      for (const file of await listTranscripts(this.deps.projectsDir)) {
        try {
          baseline.set(file, (await fs.promises.stat(file)).size)
        } catch {
          // Gone between listing and stat.
        }
      }
      if (this.deps.isEnabled()) this.offsets = baseline
      this.activating = null
    })()
    return this.activating
  }

  /** Read what was appended to these transcripts since the last look. */
  async scanChanged(files: Iterable<string>): Promise<SecretFindingRecord[]> {
    if (this.activating) await this.activating
    const offsets = this.offsets
    if (!offsets || !this.deps.isEnabled()) return []
    const found: SecretFindingRecord[] = []
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      // A transcript created after scanning started is new from its first byte.
      const from = offsets.get(file) ?? 0
      const { records, size } = await this.scanFile(file, from, 'live')
      offsets.set(file, size)
      found.push(...records)
    }
    return this.record(found)
  }

  /** Read every transcript on disk. Independent of live scanning. */
  async scanHistory(): Promise<SecretHistoryScanResult> {
    const started = Date.now()
    const files = await listTranscripts(this.deps.projectsDir)
    const found: SecretFindingRecord[] = []
    for (const file of files) {
      found.push(...(await this.scanFile(file, 0, 'history')).records)
    }
    const added = this.record(found)
    return {
      filesScanned: files.length,
      newFindings: added.length,
      durationMs: Date.now() - started,
    }
  }

  private record(found: SecretFindingRecord[]): SecretFindingRecord[] {
    const added = this.deps.store.add(found)
    if (added.length > 0) this.deps.onNewFindings(added)
    return added
  }

  private async scanFile(
    file: string,
    fromOffset: number,
    source: SecretFindingRecord['source']
  ): Promise<{ records: SecretFindingRecord[]; size: number }> {
    const location = resolveSessionFileLocation(file, this.deps.projectsDir)
    let size: number
    try {
      size = (await fs.promises.stat(file)).size
    } catch {
      return { records: [], size: fromOffset }
    }
    // Shrunk (rewritten) since last time: what is there now has not been read.
    const start = size < fromOffset ? 0 : fromOffset
    if (!location || size === start) return { records: [], size }

    const agentId = location.isSubagent
      ? path.basename(file, '.jsonl').replace(/^agent-/, '')
      : undefined
    const scanner = createLineScanner()
    const foundAt = (this.deps.now?.() ?? new Date()).toISOString()
    const records: SecretFindingRecord[] = []
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { start, end: size - 1 }),
      crlfDelay: Infinity,
    })
    let lineNumber = 0
    for await (const line of rl) {
      lineNumber++
      if (lineNumber % YIELD_EVERY_LINES === 0) await new Promise((r) => setImmediate(r))
      const onLine = scanner
        .scan(line, lineNumber)
        .sort((a, b) => (SPECIFICITY[a.checkId] ?? 9) - (SPECIFICITY[b.checkId] ?? 9))
      for (const finding of onLine) {
        const fingerprint = fingerprintOf(finding)
        records.push({
          id: `${fingerprint}:${location.sessionId}`,
          fingerprint,
          checkId: finding.checkId,
          severity: finding.severity,
          patternName: finding.patternName,
          maskedValue: finding.maskedValue,
          projectId: location.projectId,
          sessionId: location.sessionId,
          ...(agentId ? { agentId } : {}),
          // Line numbers count from where the read began; only a whole-file read gives a real one.
          ...(start === 0 ? { lineNumber } : {}),
          ...(line.match(TIMESTAMP)?.[1] ? { occurredAt: line.match(TIMESTAMP)![1] } : {}),
          foundAt,
          source,
          dismissed: false,
        })
      }
    }
    return { records, size }
  }
}

// ─── Singleton for the app ────────────────────────────────────────────────────

let service: SecretScanService | null = null
let findingsStore: SecretFindingsStore | null = null

export function initSecretScanService(deps: SecretScanServiceDeps): SecretScanService {
  findingsStore = deps.store
  service = new SecretScanService(deps)
  return service
}

export function getSecretScanService(): SecretScanService | null {
  return service
}

export function getSecretFindingsStore(): SecretFindingsStore | null {
  return findingsStore
}
