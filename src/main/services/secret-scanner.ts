import * as fs from 'fs'
import * as readline from 'readline'
import { shannonEntropy, uniqueCharCount } from '@shared/utils/entropy'
import type { LintCheckId, LintSeverity } from '@shared/types/lint'
import { SECRET_SCAN_MAX_PER_PATTERN } from '@shared/constants/tuning'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SecretFinding {
  checkId: LintCheckId
  severity: LintSeverity
  patternName: string
  rawValue: string
  maskedValue: string
  lineNumber: number
  lineText: string
}

interface PatternDef {
  id: LintCheckId
  severity: LintSeverity
  name: string
  regex: RegExp
  captureGroup?: number
  entropyThreshold?: number
  requiresDigit?: boolean
  skipHosts?: string[]
}

// ─── Pattern Definitions ──────────────────────────────────────────────────────

const PATTERNS: PatternDef[] = [
  {
    id: 'SEC001',
    severity: 'error',
    name: 'Private Key',
    regex: /-----BEGIN (RSA|EC|DSA|OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'SEC002',
    severity: 'error',
    name: 'AWS Access Key',
    regex: /(AKIA|ASIA)[A-Z0-9]{16}/,
    entropyThreshold: 3.0,
  },
  {
    id: 'SEC003',
    severity: 'warning',
    name: 'Authorization Header',
    regex: /Authorization.*?(Bearer|Basic)\s+([A-Za-z0-9+/=._-]{20,})/,
    captureGroup: 2,
    entropyThreshold: 3.5,
    requiresDigit: true,
  },
  {
    id: 'SEC004',
    severity: 'warning',
    name: 'API Key/Token',
    regex: /(api[_-]?key|api[_-]?token|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{20,})/i,
    captureGroup: 2,
    entropyThreshold: 3.5,
    requiresDigit: true,
  },
  {
    id: 'SEC005',
    severity: 'warning',
    name: 'Password Literal',
    regex: /(password|passwd|secret)\s*[:=]\s*["']([^"']{12,})["']/i,
    captureGroup: 2,
    entropyThreshold: 3.0,
    requiresDigit: true,
  },
  {
    id: 'SEC006',
    severity: 'warning',
    name: 'Connection String',
    regex: /(mongodb|postgres|mysql|redis|jdbc)[+a-z]*:\/\/[^:]+:([^@]+)@/,
    captureGroup: 2,
    entropyThreshold: 2.5,
    skipHosts: ['localhost', '127.0.0.1', 'example.com', 'db', 'database'],
  },
  {
    id: 'SEC007',
    severity: 'warning',
    name: 'Platform Token',
    regex:
      /(ghp_[A-Za-z0-9_]{36}|github_pat_[A-Za-z0-9_]{20,}|xox[bps]-[A-Za-z0-9./-]{20,}|npm_[A-Za-z0-9]{36}|sk_live_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{35}|sk-ant-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{34,})/,
  },
]

// ─── False-positive allowlist ─────────────────────────────────────────────────

const FALSE_POSITIVE_SUBSTRINGS = [
  'AKIAIOSFODNN7EXAMPLE',
  'sk_test_',
  'pk_test_',
  'your-api-key',
  '<your-',
  'placeholder',
  'changeme',
  'example',
  'TODO',
  'xxxxxxxx',
  '0000000000',
  'abcdefgh',
  'REPLACE_ME',
  'XXX',
  'REDACTED',
  'MASKED',
  'DUMMY',
  'FAKE',
  'NONE',
  'null',
  'undefined',
  'N/A',
  'INSERT_',
  'PASTE_',
  '${',
  '{{',
  '%s',
  '{0}',
]

const CONVERSATIONAL_PHRASES = [
  'in the .env',
  'set your',
  'configure the',
  'stored in',
  'replace with',
  'environment variable',
  'add to your',
  'put your',
  '.env file',
]

// ─── maskSecret ──────────────────────────────────────────────────────────────

export function maskSecret(value: string): string {
  if (value.length <= 8) return '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

// ─── isFalsePositive ─────────────────────────────────────────────────────────

function isFalsePositive(value: string, line: string): boolean {
  // Check false-positive substrings in the captured value
  for (const sub of FALSE_POSITIVE_SUBSTRINGS) {
    if (value.includes(sub)) return true
  }
  // Check conversational context in the full line
  const lineLower = line.toLowerCase()
  for (const phrase of CONVERSATIONAL_PHRASES) {
    if (lineLower.includes(phrase)) return true
  }
  return false
}

// ─── extractValue ────────────────────────────────────────────────────────────

function extractValue(match: RegExpMatchArray, captureGroup?: number): string {
  if (captureGroup !== undefined && match[captureGroup]) {
    return match[captureGroup]
  }
  return match[0]
}

// ─── scanLines ────────────────────────────────────────────────────────────────

export function scanLines(lines: string[]): SecretFinding[] {
  const findings: SecretFinding[] = []
  // Track count per pattern per "file" (this function is per-file)
  const countPerPattern: Record<string, number> = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    for (const pattern of PATTERNS) {
      const count = countPerPattern[pattern.id] ?? 0
      if (count >= SECRET_SCAN_MAX_PER_PATTERN) continue

      const match = line.match(pattern.regex)
      if (!match) continue

      const rawValue = extractValue(match, pattern.captureGroup)

      // Skip connection strings with safe hosts
      if (pattern.skipHosts) {
        const urlMatch = line.match(/\/\/([^:]+):/)
        const host = urlMatch ? urlMatch[1] : ''
        if (pattern.skipHosts.some((h) => host.includes(h))) continue
      }

      // Entropy check
      if (pattern.entropyThreshold !== undefined) {
        if (shannonEntropy(rawValue) < pattern.entropyThreshold) continue
      }

      // Requires digit check
      if (pattern.requiresDigit && !/\d/.test(rawValue)) continue

      // Unique char count sanity check (must have at least 5 unique chars for warnings)
      if (pattern.severity !== 'error' && uniqueCharCount(rawValue) < 5) continue

      // False positive check
      if (isFalsePositive(rawValue, line)) continue

      findings.push({
        checkId: pattern.id,
        severity: pattern.severity,
        patternName: pattern.name,
        rawValue,
        maskedValue: maskSecret(rawValue),
        lineNumber: i + 1,
        lineText: line.slice(0, 200), // truncate long lines
      })

      countPerPattern[pattern.id] = count + 1
    }
  }

  return findings
}

// ─── scanFileDelta ────────────────────────────────────────────────────────────

/**
 * Read only new content from `filePath` starting at `fromOffset` bytes.
 * Returns findings in the new content and the new byte offset.
 */
export async function scanFileDelta(
  filePath: string,
  fromOffset: number
): Promise<{ findings: SecretFinding[]; newOffset: number }> {
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(filePath)
  } catch {
    return { findings: [], newOffset: fromOffset }
  }

  const fileSize = stat.size
  if (fileSize <= fromOffset) {
    return { findings: [], newOffset: fromOffset }
  }

  // Stream only the new bytes via readline so large appends don't allocate a single Buffer.
  const stream = fs.createReadStream(filePath, { start: fromOffset })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  const lines: string[] = []
  for await (const line of rl) {
    lines.push(line)
  }
  const findings = scanLines(lines)

  return { findings, newOffset: fileSize }
}

// ─── scanFileLines ────────────────────────────────────────────────────────────

/**
 * Read the last `maxLines` lines from a file and scan them for secrets.
 */
export async function scanFileLines(filePath: string, maxLines = 50): Promise<SecretFinding[]> {
  const lines: string[] = []

  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    for await (const line of rl) {
      lines.push(line)
      if (lines.length > maxLines * 2) {
        lines.splice(0, lines.length - maxLines)
      }
    }
  } catch {
    return []
  }

  const tail = lines.slice(-maxLines)
  return scanLines(tail)
}
