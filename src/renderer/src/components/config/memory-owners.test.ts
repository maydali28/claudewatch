import { describe, expect, it } from 'vitest'
import { buildMemoryOwners, visibleMemoryOwners } from './memory-owners'
import type { MemoryFile } from '@shared/types'
import type { ProjectClaudeMd } from '@shared/types/project'

const global: MemoryFile = {
  id: 'global-claude-md',
  label: 'CLAUDE.md',
  sublabel: 'global',
  path: '/home/.claude/CLAUDE.md',
  content: '',
}
const note = (projectId: string, projectName: string, name: string): MemoryFile => ({
  id: `memory:${projectId}:${name}`,
  label: name.replace(/\.md$/, ''),
  sublabel: 'auto-memory',
  path: `/home/.claude/projects/${projectId}/memory/${name}`,
  projectId,
  projectName,
})
const projectMd = (projectId: string, projectName: string): ProjectClaudeMd => ({
  projectId,
  projectName,
  projectPath: `/repos/${projectName}`,
  filePath: `/repos/${projectName}/CLAUDE.md`,
  content: '# rules',
  sizeBytes: 7,
})

describe('buildMemoryOwners', () => {
  const owners = buildMemoryOwners(
    [
      global,
      note('p-cw', 'claudewatch', 'MEMORY.md'),
      note('p-cw', 'claudewatch', 'branching.md'),
      note('p-dali', 'dali', 'MEMORY.md'),
    ],
    [projectMd('p-dali', 'dali'), projectMd('p-booking', 'public-booking-page')]
  )

  it('makes Global first, then one owner per project sorted by name', () => {
    expect(owners.map((o) => [o.id, o.label])).toEqual([
      ['global', 'Global'],
      ['p-cw', 'claudewatch'],
      ['p-dali', 'dali'],
      ['p-booking', 'public-booking-page'],
    ])
  })

  it('puts a project’s CLAUDE.md first, then its notes', () => {
    const dali = owners.find((o) => o.id === 'p-dali')!
    expect(dali.files.map((f) => f.id)).toEqual([
      'project-claude-md:p-dali',
      'memory:p-dali:MEMORY.md',
    ])
    expect(dali.files[0]).toMatchObject({
      label: 'CLAUDE.md',
      sublabel: 'project',
      path: '/repos/dali/CLAUDE.md',
      content: '# rules',
    })
  })

  it('has no Global owner when there is no global CLAUDE.md', () => {
    expect(buildMemoryOwners([note('p', 'x', 'a.md')], []).map((o) => o.id)).toEqual(['p'])
  })
})

describe('visibleMemoryOwners', () => {
  const owners = buildMemoryOwners(
    [global, note('p-cw', 'claudewatch', 'branching.md')],
    [projectMd('p-dali', 'dali')]
  )

  it('keeps only owners with a file of the chosen kind, with only those files', () => {
    expect(visibleMemoryOwners(owners, 'auto', '').map((o) => o.id)).toEqual(['p-cw'])
    expect(visibleMemoryOwners(owners, 'project', '').map((o) => o.id)).toEqual(['p-dali'])
    expect(visibleMemoryOwners(owners, 'all', '')).toHaveLength(3)
  })

  it('matches the search against the owner name or a file name', () => {
    expect(visibleMemoryOwners(owners, 'all', 'dal').map((o) => o.id)).toEqual(['p-dali'])
    const byFile = visibleMemoryOwners(owners, 'all', 'branch')
    expect(byFile.map((o) => o.id)).toEqual(['p-cw'])
    expect(byFile[0].files.map((f) => f.label)).toEqual(['branching'])
  })
})
