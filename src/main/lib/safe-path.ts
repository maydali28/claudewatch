import * as path from 'path'

/**
 * Resolve `filePath` and assert it stays within `baseDir`.
 * Throws if the resolved path escapes the base directory.
 */
export function assertSafePath(baseDir: string, ...segments: string[]): string {
  const resolved = path.resolve(baseDir, ...segments)
  const base = path.resolve(baseDir)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal detected: ${resolved} is outside ${base}`)
  }
  return resolved
}
