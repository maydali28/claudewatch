import type { MemoryFile } from '@shared/types'
import type { ProjectClaudeMd } from '@shared/types/project'
import { memoryKindOf, type MemoryFilter } from './memory-filter'

/** Whose memory a set of files is: the global CLAUDE.md, or one project's CLAUDE.md and notes. */
export interface MemoryOwner {
  id: string
  label: string
  kind: 'global' | 'project'
  /** The project's CLAUDE.md first, then its MEMORY.md index, then its notes. */
  files: MemoryFile[]
}

/** A project's CLAUDE.md as a memory file, with the id the panel selects it by. */
export function projectClaudeMdFile(p: ProjectClaudeMd): MemoryFile {
  return {
    id: `project-claude-md:${p.projectId}`,
    label: 'CLAUDE.md',
    sublabel: 'project',
    path: p.filePath,
    content: p.content,
    sizeBytes: p.sizeBytes,
    projectId: p.projectId,
    projectName: p.projectName,
  }
}

/**
 * One owner per source of memory: Global (the global CLAUDE.md), then one
 * per project holding its CLAUDE.md and its auto-memory notes, sorted by
 * project name.
 */
export function buildMemoryOwners(
  memoryFiles: MemoryFile[],
  projectClaudeMds: ProjectClaudeMd[]
): MemoryOwner[] {
  const globalFiles = memoryFiles.filter((f) => memoryKindOf(f) === 'global')
  const projects = new Map<string, MemoryOwner>()
  const ownerFor = (id: string, label: string): MemoryOwner => {
    let owner = projects.get(id)
    if (!owner) {
      owner = { id, label, kind: 'project', files: [] }
      projects.set(id, owner)
    }
    return owner
  }

  for (const p of projectClaudeMds)
    ownerFor(p.projectId, p.projectName).files.push(projectClaudeMdFile(p))
  for (const f of memoryFiles) {
    if (memoryKindOf(f) === 'global') continue
    ownerFor(f.projectId ?? f.id, f.projectName ?? f.label).files.push(f)
  }

  return [
    ...(globalFiles.length > 0
      ? [{ id: 'global', label: 'Global', kind: 'global' as const, files: globalFiles }]
      : []),
    ...[...projects.values()].sort((a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase())
    ),
  ]
}

/** "CLAUDE.md · 3 notes", "2 notes" or "CLAUDE.md". */
export function memoryOwnerSummary(owner: MemoryOwner): string {
  const notes = owner.files.filter((f) => memoryKindOf(f) === 'auto').length
  const hasClaudeMd = owner.files.some((f) => memoryKindOf(f) !== 'auto')
  return [
    ...(hasClaudeMd ? ['CLAUDE.md'] : []),
    ...(notes > 0 ? [`${notes} note${notes === 1 ? '' : 's'}`] : []),
  ].join(' · ')
}

/**
 * The owners the sidebar shows for a kind filter and a search: each keeps
 * only its files of that kind, and owners left with none are dropped. The
 * search matches the owner's name (keeping all its files) or a file's name.
 */
export function visibleMemoryOwners(
  owners: MemoryOwner[],
  filter: MemoryFilter,
  search: string
): MemoryOwner[] {
  const q = search.trim().toLowerCase()
  return owners
    .map((owner) => {
      const ofKind = owner.files.filter((f) => filter === 'all' || memoryKindOf(f) === filter)
      const files =
        !q || owner.label.toLowerCase().includes(q)
          ? ofKind
          : ofKind.filter((f) => f.label.toLowerCase().includes(q))
      return { ...owner, files }
    })
    .filter((owner) => owner.files.length > 0)
}
