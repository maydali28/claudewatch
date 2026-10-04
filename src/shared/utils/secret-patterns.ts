import { shannonEntropy, uniqueCharCount } from './entropy'
import type { LintCheckId, LintSeverity } from '@shared/types/lint'
import { SECRET_SCAN_MAX_PER_PATTERN } from '@shared/constants/tuning'

// Secret detection, shared by the main process (scanning transcripts) and
// redaction (masking what the viewer and exports show). Pure: no file access.

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

// ─── passesChecks ────────────────────────────────────────────────────────────

/** Whether a pattern's match is a likely real secret rather than noise or a placeholder. */
function passesChecks(pattern: PatternDef, rawValue: string, line: string): boolean {
  // Skip connection strings with safe hosts
  if (pattern.skipHosts) {
    const urlMatch = line.match(/\/\/([^:]+):/)
    const host = urlMatch ? urlMatch[1] : ''
    if (pattern.skipHosts.some((h) => host.includes(h))) return false
  }
  // Entropy check
  if (
    pattern.entropyThreshold !== undefined &&
    shannonEntropy(rawValue) < pattern.entropyThreshold
  ) {
    return false
  }
  // Requires digit check
  if (pattern.requiresDigit && !/\d/.test(rawValue)) return false
  // Unique char count sanity check (must have at least 5 unique chars for warnings)
  if (pattern.severity !== 'error' && uniqueCharCount(rawValue) < 5) return false
  // False positive check
  return !isFalsePositive(rawValue, line)
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

      if (!passesChecks(pattern, rawValue, line)) continue

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

// ─── createLineScanner ───────────────────────────────────────────────────────

/**
 * `scanLines` for a stream: feed one line at a time, with the per-pattern cap
 * kept across calls, so a large transcript need not be held in memory.
 */
export function createLineScanner(maxPerPattern = SECRET_SCAN_MAX_PER_PATTERN): {
  scan(line: string, lineNumber: number): SecretFinding[]
} {
  const countPerPattern: Record<string, number> = {}
  return {
    scan(line, lineNumber) {
      const found: SecretFinding[] = []
      for (const pattern of PATTERNS) {
        const count = countPerPattern[pattern.id] ?? 0
        if (count >= maxPerPattern) continue
        const match = line.match(pattern.regex)
        if (!match) continue
        const rawValue = extractValue(match, pattern.captureGroup)
        if (!passesChecks(pattern, rawValue, line)) continue
        found.push({
          checkId: pattern.id,
          severity: pattern.severity,
          patternName: pattern.name,
          rawValue,
          maskedValue: maskSecret(rawValue),
          lineNumber,
          lineText: line.slice(0, 200),
        })
        countPerPattern[pattern.id] = count + 1
      }
      return found
    },
  }
}

// ─── Redaction ────────────────────────────────────────────────────────────────

export type RedactionLevel = 'none' | 'mask' | 'remove'

export const REDACTED_PLACEHOLDER = '[REDACTED]'

const PEM_BLOCK =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|$)/g

/**
 * Every secret value in `text`, by the same rules as `scanLines` (entropy,
 * digit, unique-character and false-positive checks) but with no per-pattern
 * cap: redaction must catch every occurrence, not the first few.
 */
export function findSecretValues(text: string): string[] {
  const values = new Set<string>()
  for (const line of text.split('\n')) {
    for (const pattern of PATTERNS) {
      const global = new RegExp(
        pattern.regex.source,
        pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g'
      )
      for (const match of line.matchAll(global)) {
        const rawValue = extractValue(match, pattern.captureGroup)
        if (passesChecks(pattern, rawValue, line)) values.add(rawValue)
      }
    }
  }
  return [...values]
}

/** `text` with every secret masked (`sk-a****9f3c`) or replaced by `[REDACTED]`. */
export function redactText(text: string, level: RedactionLevel): string {
  if (level === 'none' || !text) return text
  // A private key's body has no pattern of its own; only its header line
  // matches. Replace the whole block so no line of the key survives.
  let out = text.replace(PEM_BLOCK, (block) =>
    level === 'mask'
      ? `${block.split('\n')[0]}\n****\n-----END PRIVATE KEY-----`
      : REDACTED_PLACEHOLDER
  )
  // Longest first, so a value that contains another is replaced whole.
  for (const value of findSecretValues(text).sort((a, b) => b.length - a.length)) {
    out = out.split(value).join(level === 'mask' ? maskSecret(value) : REDACTED_PLACEHOLDER)
  }
  return out
}
