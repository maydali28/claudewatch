import * as fs from 'fs'
import * as readline from 'readline'
import { scanLines, type SecretFinding } from '@shared/utils/secret-patterns'

export { maskSecret, scanLines, type SecretFinding } from '@shared/utils/secret-patterns'

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
