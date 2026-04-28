/**
 * Claude Code stores projects as URL-encoded directory names under ~/.claude/projects/.
 * e.g. "-Users-alice-workspace-my-project" → "/Users/alice/workspace/my-project"
 *
 * The encoding replaces path separators (/) with hyphens (-) after the drive/root.
 * On Windows paths look like "-C:-Users-alice-..." → "C:\Users\alice\..."
 */
export function decodeProjectId(encodedId: string): string {
  // Simple heuristic: replace leading hyphen-separated segments with slashes
  // The format is the path with "/" replaced by "-" (POSIX) or "\" replaced by "-" (Win)
  if (!encodedId) return encodedId

  // Handle Windows paths encoded as -C:-Users-...
  const winDriveMatch = encodedId.match(/^-([A-Za-z]):-(.+)$/)
  if (winDriveMatch) {
    return `${winDriveMatch[1]}:\\${winDriveMatch[2].replace(/-/g, '\\')}`
  }

  // POSIX: leading hyphen means the path started with "/"
  if (encodedId.startsWith('-')) {
    return '/' + encodedId.slice(1).replace(/-/g, '/')
  }

  return encodedId
}

/** Produce a short human-readable display name from a decoded project path. */
export function projectDisplayName(decodedPath: string): string {
  const parts = decodedPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}
