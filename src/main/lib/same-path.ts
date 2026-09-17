import * as fs from 'fs'
import * as path from 'path'

/**
 * The location a path really names: symlinks followed, via
 * `fs.realpathSync.native`. A path that doesn't exist (yet) keeps its
 * missing tail but has its deepest existing folder resolved, so
 * `<link>/.claude/settings.json` and `<real>/.claude/settings.json` still
 * match when the file is absent. With nothing on the path existing, this is
 * `path.resolve(p)`.
 */
function canonicalPath(p: string): string {
  let current = path.resolve(p)
  const missing: string[] = []
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(p)
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Whether two paths name the same location. A home folder reached through a
 * symlink names the user's Claude files under a second spelling, so the text
 * of the paths alone is not enough.
 */
export function samePath(a: string, b: string): boolean {
  if (path.resolve(a) === path.resolve(b)) return true
  return canonicalPath(a) === canonicalPath(b)
}
