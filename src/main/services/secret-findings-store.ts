import * as fs from 'fs'
import * as path from 'path'
import type { SecretFindingRecord } from '@shared/types/secrets'

// The secret findings list, persisted as one small JSON file beside the
// preferences. It holds masked values and one-way fingerprints only; the
// secrets themselves never leave the transcripts they were found in.

const FILE_NAME = 'secret-findings.json'
const FILE_VERSION = 1
/** Oldest dismissed findings go first, then the oldest of the rest. */
export const MAX_FINDINGS = 1000

interface FileShape {
  version: number
  findings: SecretFindingRecord[]
}

export interface SecretFindingsStore {
  list(): SecretFindingRecord[]
  /** Adds the findings not already stored; returns those. */
  add(findings: readonly SecretFindingRecord[]): SecretFindingRecord[]
  dismiss(ids: readonly string[]): void
}

function capped(findings: SecretFindingRecord[]): SecretFindingRecord[] {
  if (findings.length <= MAX_FINDINGS) return findings
  const byAge = (a: SecretFindingRecord, b: SecretFindingRecord): number =>
    a.foundAt.localeCompare(b.foundAt)
  const dismissed = findings.filter((f) => f.dismissed).sort(byAge)
  const active = findings.filter((f) => !f.dismissed).sort(byAge)
  const excess = findings.length - MAX_FINDINGS
  const drop = new Set([...dismissed, ...active].slice(0, excess).map((f) => f.id))
  return findings.filter((f) => !drop.has(f.id))
}

export function createSecretFindingsStore(dir: string): SecretFindingsStore {
  const filePath = path.join(dir, FILE_NAME)
  let findings: SecretFindingRecord[] = []
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FileShape
    if (parsed.version === FILE_VERSION && Array.isArray(parsed.findings))
      findings = parsed.findings
  } catch {
    // No file yet, or unreadable: start empty rather than fail.
  }

  const save = (): void => {
    const shape: FileShape = { version: FILE_VERSION, findings }
    const tmp = `${filePath}.tmp`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(shape))
    fs.renameSync(tmp, filePath)
  }

  return {
    list: () => [...findings],
    add(incoming) {
      const known = new Set(findings.map((f) => f.id))
      const added: SecretFindingRecord[] = []
      for (const f of incoming) {
        if (known.has(f.id)) continue
        known.add(f.id)
        added.push(f)
      }
      if (added.length > 0) {
        findings = capped([...findings, ...added])
        save()
      }
      return added
    },
    dismiss(ids) {
      const set = new Set(ids)
      let changed = false
      findings = findings.map((f) => {
        if (!set.has(f.id) || f.dismissed) return f
        changed = true
        return { ...f, dismissed: true }
      })
      if (changed) save()
    },
  }
}
