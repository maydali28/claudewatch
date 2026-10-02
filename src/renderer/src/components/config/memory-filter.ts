import type { MemoryFile } from '@shared/types'

/** The Memory tab's chips: the global CLAUDE.md, project CLAUDE.md files, Claude Code's auto-memory notes. */
export type MemoryKind = 'global' | 'project' | 'auto'
export type MemoryFilter = 'all' | MemoryKind

/** A memory file's kind, from the label `readMemoryFiles` gives it. */
export function memoryKindOf(file: MemoryFile): MemoryKind {
  switch (file.sublabel) {
    case 'project':
      return 'project'
    case 'auto-memory':
      return 'auto'
    default:
      return 'global'
  }
}

/** Counts per chip; each project's CLAUDE.md (listed separately) counts as Project. */
export function countMemoryByKind(
  files: MemoryFile[],
  projectClaudeMdCount: number
): Record<MemoryFilter, number> {
  const counts: Record<MemoryFilter, number> = {
    all: files.length + projectClaudeMdCount,
    global: 0,
    project: projectClaudeMdCount,
    auto: 0,
  }
  for (const f of files) counts[memoryKindOf(f)]++
  return counts
}
