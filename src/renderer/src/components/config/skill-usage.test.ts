import { describe, expect, it } from 'vitest'
import { relativeDay, sessionOnlyNote } from './skill-usage'
import type { SkillEntry } from '@shared/types'

const NOW = Date.parse('2026-10-02T12:00:00.000Z')

describe('relativeDay', () => {
  it('says today, yesterday, n days ago, then the date', () => {
    expect(relativeDay('2026-10-02T08:00:00.000Z', NOW)).toBe('today')
    expect(relativeDay('2026-10-01T08:00:00.000Z', NOW)).toBe('yesterday')
    expect(relativeDay('2026-09-25T12:00:00.000Z', NOW)).toBe('7d ago')
    expect(relativeDay('2026-08-01T12:00:00.000Z', NOW)).toMatch(/Aug/)
  })

  it('returns an empty string for a missing or unreadable date', () => {
    expect(relativeDay('', NOW)).toBe('')
    expect(relativeDay('not a date', NOW)).toBe('')
  })
})

describe('sessionOnlyNote', () => {
  const skill = (o: Partial<SkillEntry>): SkillEntry => ({
    id: 'x',
    name: 'x',
    displayName: 'x',
    metadata: {},
    body: '',
    sizeBytes: 0,
    sessionOnly: true,
    ...o,
  })

  it('explains where a skill with no file comes from', () => {
    expect(
      sessionOnlyNote(skill({ source: { kind: 'builtin', id: 'builtin', label: 'Built-in' } }))
    ).toBe(
      'Built into Claude Code. It has no file on disk; name and description come from your sessions.'
    )
    expect(
      sessionOnlyNote(
        skill({
          source: {
            kind: 'plugin',
            id: 'plugin:anthropic-skills@claude.ai',
            label: 'anthropic-skills',
            plugin: { name: 'anthropic-skills', origin: 'claude.ai', enabled: true },
          },
        })
      )
    ).toBe(
      'Provided by your claude.ai account. It has no file on disk; name and description come from your sessions.'
    )
    expect(
      sessionOnlyNote(
        skill({
          source: {
            kind: 'plugin',
            id: 'plugin:gone@unknown',
            label: 'gone',
            plugin: { name: 'gone', origin: 'marketplace', enabled: false, installed: false },
          },
        })
      )
    ).toBe('From the gone plugin, which is no longer installed. Last known from your sessions.')
    expect(sessionOnlyNote(skill({ exposedAs: 'command', name: 'ship' }))).toBe(
      'The /ship command, which Claude Code also offers as a skill.'
    )
  })

  it('returns null for a skill with a file', () => {
    expect(sessionOnlyNote(skill({ sessionOnly: undefined }))).toBeNull()
  })
})
