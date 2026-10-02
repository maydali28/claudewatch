import { describe, expect, it } from 'vitest'
import type { RawRecord } from '@shared/types/session'
import { createSkillListingCollector } from './skill-listing'

function listing(names: string[], content: string, isInitial = true): RawRecord {
  return {
    type: 'attachment',
    uuid: `u-${names.join(',')}`,
    attachment: { type: 'skill_listing', names, content, skillCount: names.length, isInitial },
  }
}

describe('createSkillListingCollector', () => {
  it('collects the names of skill_listing records with the description from their content', () => {
    const c = createSkillListingCollector()
    c.add(
      listing(
        ['humanizer', 'superpowers:brainstorming', 'code-review'],
        [
          '- humanizer: Remove signs of AI-generated writing.',
          '- superpowers:brainstorming: Use before any creative work: explore intent.',
          '- code-review: Review the current diff.',
        ].join('\n')
      )
    )

    expect(c.result()).toEqual([
      { name: 'humanizer', description: 'Remove signs of AI-generated writing.' },
      {
        name: 'superpowers:brainstorming',
        description: 'Use before any creative work: explore intent.',
      },
      { name: 'code-review', description: 'Review the current diff.' },
    ])
  })

  it('adds the skills of later delta records once each', () => {
    const c = createSkillListingCollector()
    c.add(listing(['a', 'b'], '- a: A\n- b: B'))
    c.add(listing(['b', 'c'], '- b: B again\n- c: C', false))

    expect(c.result().map((s) => s.name)).toEqual(['a', 'b', 'c'])
    expect(c.result().find((s) => s.name === 'b')?.description).toBe('B')
  })

  it('keeps a name without a description line, and cuts very long descriptions', () => {
    const c = createSkillListingCollector()
    c.add(listing(['quiet', 'long'], `- long: ${'x'.repeat(500)}`))

    const [quiet, long] = c.result()
    expect(quiet).toEqual({ name: 'quiet' })
    expect(long.description?.length).toBe(300)
    expect(long.description?.endsWith('…')).toBe(true)
  })

  it('ignores other records, other attachment types and malformed listings', () => {
    const c = createSkillListingCollector()
    c.add({ type: 'user', uuid: 'x' })
    c.add({ type: 'attachment', attachment: { type: 'agent_listing_delta' } })
    c.add({ type: 'attachment', attachment: { type: 'skill_listing', names: 'nope' } })
    c.add({ type: 'attachment', attachment: { type: 'skill_listing', names: [1, '', 'ok'] } })

    expect(c.result()).toEqual([{ name: 'ok' }])
  })

  it('returns undefined when the session had no skill listing', () => {
    expect(createSkillListingCollector().result()).toEqual([])
    expect(createSkillListingCollector().resultOrUndefined()).toBeUndefined()
  })
})
