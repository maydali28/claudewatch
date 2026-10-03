import { describe, expect, it } from 'vitest'
import {
  countMemoryByKind,
  memoryContentState,
  memoryKindOf,
  type MemoryKind,
} from './memory-filter'
import type { MemoryFile } from '@shared/types'

const file = (sublabel: string): MemoryFile => ({
  id: sublabel,
  label: 'x',
  sublabel,
  path: `/${sublabel}`,
})

describe('memoryKindOf', () => {
  it('reads the kind from what the config service labels each file', () => {
    expect(memoryKindOf(file('global'))).toBe<MemoryKind>('global')
    expect(memoryKindOf(file('project'))).toBe<MemoryKind>('project')
    expect(memoryKindOf(file('auto-memory'))).toBe<MemoryKind>('auto')
  })

  it('treats an unknown label as global', () => {
    expect(memoryKindOf(file('something-new'))).toBe<MemoryKind>('global')
  })
})

describe('memoryContentState', () => {
  it('tells an empty file from one that could not be read', () => {
    expect(memoryContentState('# Notes')).toBe('present')
    expect(memoryContentState('')).toBe('empty')
    expect(memoryContentState('  \n\t\n')).toBe('empty')
    expect(memoryContentState(undefined)).toBe('unavailable')
  })
})

describe('countMemoryByKind', () => {
  it('counts files by kind, adding each project CLAUDE.md to Project', () => {
    expect(
      countMemoryByKind([file('global'), file('auto-memory'), file('auto-memory')], 3)
    ).toEqual({ all: 6, global: 1, project: 3, auto: 2 })
  })
})
