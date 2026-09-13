import * as path from 'path'

export interface SessionFileLocation {
  projectId: string
  sessionId: string
  /** True when the change came from a subagent transcript under this session. */
  isSubagent: boolean
}

/**
 * Map a changed transcript path to the session whose summary it affects.
 *
 * Two shapes are recognised:
 *   `<project>/<session>.jsonl`
 *   `<project>/<session>/subagents/agent-<id>.jsonl`
 *
 * Both resolve to the same session, because a subagent's usage is rolled into
 * its parent's summary. Only the parent shape was accepted before, so every
 * subagent write was silently dropped: the child's spend stayed invisible until
 * a full rescan, and because the disk cache fingerprints the parent file alone,
 * even restarting the app did not pick it up.
 */
export function resolveSessionFileLocation(
  filePath: string,
  projectsDir: string
): SessionFileLocation | null {
  const relativePath = path.relative(projectsDir, filePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null

  const parts = relativePath.split(path.sep)

  if (parts.length === 2) {
    return {
      projectId: parts[0],
      sessionId: path.basename(parts[1], '.jsonl'),
      isSubagent: false,
    }
  }

  if (parts.length === 4 && parts[2] === 'subagents') {
    return {
      projectId: parts[0],
      sessionId: parts[1],
      isSubagent: true,
    }
  }

  return null
}
