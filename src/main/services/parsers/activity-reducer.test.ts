import { describe, expect, it } from 'vitest'
import { createActivityAccumulator, UNDATED_DAY } from './activity-reducer'
import type { RawRecord } from '@shared/types/session'

function assistantBlock(uuid: string, id: string, type: string, ts: string): RawRecord {
  return {
    type: 'assistant',
    uuid,
    timestamp: ts,
    message: { id, model: 'claude-opus-5', content: [{ type }] },
  } as unknown as RawRecord
}

describe('createActivityAccumulator', () => {
  it('counts one assistant message per api response, not per content record', () => {
    const acc = createActivityAccumulator()
    acc.add(assistantBlock('u1', 'msg_1', 'thinking', '2026-09-10T10:00:00.000Z'))
    acc.add(assistantBlock('u2', 'msg_1', 'text', '2026-09-10T10:00:01.000Z'))
    acc.add(assistantBlock('u3', 'msg_1', 'tool_use', '2026-09-10T10:00:02.000Z'))

    const counts = acc.counts()
    expect(counts.assistantResponses).toBe(1)
    expect(counts.total).toBe(1)
  })

  it('counts user messages but not tool-result carriers', () => {
    const acc = createActivityAccumulator()
    acc.add({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-09-10T10:00:00.000Z',
      message: { content: [{ type: 'text', text: 'hi' }] },
    } as unknown as RawRecord)
    acc.add({
      type: 'user',
      uuid: 'u2',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { content: [{ type: 'tool_result' }] },
    } as unknown as RawRecord)

    expect(acc.counts().userMessages).toBe(1)
  })

  it('attributes a response to the day of its first record', () => {
    const acc = createActivityAccumulator()
    acc.add(assistantBlock('u1', 'msg_1', 'thinking', '2026-09-10T23:59:59.000Z'))
    acc.add(assistantBlock('u2', 'msg_1', 'text', '2026-09-11T00:00:01.000Z'))

    const days = [...acc.counts().byDay.keys()].sort()
    expect(days).toHaveLength(1)
    expect(acc.counts().byDay.get(days[0])?.assistant).toBe(1)
  })

  it('ignores replayed uuids, compact summaries, progress and transcript-only records', () => {
    const acc = createActivityAccumulator()
    acc.add(assistantBlock('u1', 'msg_1', 'text', '2026-09-10T10:00:00.000Z'))
    acc.add(assistantBlock('u1', 'msg_1', 'text', '2026-09-10T10:00:00.000Z'))
    acc.add({
      type: 'assistant',
      uuid: 'u2',
      isCompactSummary: true,
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { id: 'msg_2' },
    } as unknown as RawRecord)
    acc.add({
      type: 'progress',
      uuid: 'u3',
      timestamp: '2026-09-10T10:00:02.000Z',
    } as unknown as RawRecord)
    acc.add({
      type: 'assistant',
      uuid: 'u4',
      isVisibleInTranscriptOnly: true,
      timestamp: '2026-09-10T10:00:03.000Z',
      message: { id: 'msg_3' },
    } as unknown as RawRecord)
    acc.add({
      type: 'assistant',
      uuid: 'u5',
      timestamp: '2026-09-10T10:00:04.000Z',
      message: { id: 'msg_4', model: '<synthetic>' },
    } as unknown as RawRecord)

    expect(acc.counts().assistantResponses).toBe(1)
  })

  it('keys a response with no message id off its record uuid', () => {
    const acc = createActivityAccumulator()
    acc.add({
      type: 'assistant',
      uuid: 'u1',
      timestamp: '2026-09-10T10:00:00.000Z',
      message: { model: 'claude-opus-5' },
    } as unknown as RawRecord)
    acc.add({
      type: 'assistant',
      uuid: 'u2',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { model: 'claude-opus-5' },
    } as unknown as RawRecord)

    expect(acc.counts().assistantResponses).toBe(2)
  })
})

/**
 * L16: a "user message" is a prompt a person wrote. Claude Code also writes
 * `type: 'user'` records for background task notices, sub-agent hand-backs,
 * injected context, local slash commands and the Esc marker; counting those
 * inflated the user message count on real history.
 */
describe('createActivityAccumulator — only prompts count as user messages', () => {
  const day = '2026-09-10'
  const at = (s: number): string => `${day}T10:00:${String(s).padStart(2, '0')}.000Z`
  function rec(
    uuid: string,
    s: number,
    fields: Record<string, unknown>,
    content: unknown
  ): RawRecord {
    return {
      type: 'user',
      uuid,
      timestamp: at(s),
      message: { role: 'user', content },
      ...fields,
    } as unknown as RawRecord
  }

  it('counts 2 prompts among 8 user records of every kind', () => {
    const acc = createActivityAccumulator()
    acc.add(rec('p1', 0, { origin: { kind: 'human' } }, 'first prompt'))
    acc.add(rec('p2', 1, {}, [{ type: 'text', text: 'prompt from an older writer' }]))
    acc.add(
      rec(
        't1',
        2,
        { origin: { kind: 'task-notification' } },
        '<task-notification>\n<summary>done</summary>\n</task-notification>'
      )
    )
    acc.add(
      rec(
        'h1',
        3,
        { isMeta: true, origin: { kind: 'peer', from: 'a1', handback: true } },
        'Another Claude session sent a message:\n<agent-message from="a1">\nreport\n</agent-message>'
      )
    )
    acc.add(rec('m1', 4, { isMeta: true }, 'Base directory for this skill: /x'))
    acc.add(rec('c1', 5, {}, '<command-name>/model</command-name>'))
    acc.add(rec('i1', 6, {}, [{ type: 'text', text: '[Request interrupted by user]' }]))
    acc.add(rec('r1', 7, {}, [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }]))

    const counts = acc.counts()
    expect(counts.userMessages).toBe(2)
    expect(counts.total).toBe(2)
    expect(counts.byDay.get(day)?.user).toBe(2)
    const daySum = [...counts.byDay.values()].reduce((s, d) => s + d.user + d.assistant, 0)
    expect(daySum).toBe(counts.total)
  })

  it('leaves no empty day bucket behind for a day with only non-prompt records', () => {
    const acc = createActivityAccumulator()
    acc.add(rec('m1', 0, { isMeta: true }, 'injected'))
    expect(acc.counts().byDay.size).toBe(0)
  })
})

/**
 * Task 5: a message with no parsable timestamp still bumped the lifetime
 * `userMessages`/`assistantResponses` totals but `bump()` silently dropped it
 * from `byDay` (it returned early for an `undefined` day) — breaking
 * `sum(byDay) === lifetime` for exactly the messages that most needed a home.
 */
describe('createActivityAccumulator — undated activity', () => {
  it('routes a user message with no timestamp into the undated bucket instead of dropping it from byDay', () => {
    const acc = createActivityAccumulator()
    acc.add({
      type: 'user',
      uuid: 'u1',
      message: { content: [{ type: 'text', text: 'hi' }] },
    } as unknown as RawRecord)

    const counts = acc.counts()
    expect(counts.userMessages).toBe(1)
    expect(counts.byDay.get(UNDATED_DAY)?.user).toBe(1)
    const daySum = [...counts.byDay.values()].reduce((s, d) => s + d.user + d.assistant, 0)
    expect(daySum).toBe(counts.total)
  })

  it('routes an undated assistant response into the undated bucket the same way', () => {
    const acc = createActivityAccumulator()
    acc.add({
      type: 'assistant',
      uuid: 'a1',
      message: { id: 'msg_1', model: 'claude-opus-5' },
    } as unknown as RawRecord)

    const counts = acc.counts()
    expect(counts.assistantResponses).toBe(1)
    expect(counts.byDay.get(UNDATED_DAY)?.assistant).toBe(1)
  })

  /**
   * The "later fragment repairs an earlier fragment's missing date" case: the
   * record that first introduces a response id has no timestamp, but a later
   * content-block record of the SAME response does. The response was already
   * counted (and provisionally undated) by the time the real date arrives, so
   * fixing it requires moving the count, not just reading a better value.
   */
  it('repairs an undated response once a later record of it reports a real timestamp', () => {
    const acc = createActivityAccumulator()
    acc.add({
      type: 'assistant',
      uuid: 'a1',
      message: { id: 'msg_1', model: 'claude-opus-5', content: [{ type: 'thinking' }] },
    } as unknown as RawRecord)
    acc.add({
      type: 'assistant',
      uuid: 'a2',
      timestamp: '2026-09-10T10:00:00.000Z',
      message: { id: 'msg_1', model: 'claude-opus-5', content: [{ type: 'text' }] },
    } as unknown as RawRecord)

    const counts = acc.counts()
    expect(counts.assistantResponses).toBe(1)
    expect(counts.byDay.get(UNDATED_DAY)?.assistant ?? 0).toBe(0)
    expect(counts.byDay.get('2026-09-10')?.assistant).toBe(1)
    const daySum = [...counts.byDay.values()].reduce((s, d) => s + d.user + d.assistant, 0)
    expect(daySum).toBe(counts.total)
  })

  /**
   * Task 1: a malformed (present but unparsable) timestamp used to produce the
   * day key `NaN-NaN-NaN` instead of falling into `UNDATED_DAY`, so the repair
   * path above could never recognise or reclaim it.
   */
  it('repairs a malformed first timestamp from a later valid fragment', () => {
    const acc = createActivityAccumulator()
    acc.add(assistantBlock('a', 'msg_1', 'thinking', 'invalid'))
    acc.add(assistantBlock('b', 'msg_1', 'text', '2026-09-15T10:00:00.000Z'))

    const days = acc.counts().byDay
    expect(days.get(UNDATED_DAY)?.assistant ?? 0).toBe(0)
    expect(days.get('2026-09-15')?.assistant).toBe(1)
    expect([...days.keys()].some((k) => k.includes('NaN'))).toBe(false)
    expect(acc.counts().assistantResponses).toBe(1)
  })

  it('buckets a malformed user timestamp as undated, not NaN', () => {
    const acc = createActivityAccumulator()
    acc.add({
      type: 'user',
      uuid: 'u1',
      timestamp: 'invalid',
      message: { content: [{ type: 'text', text: 'hi' }] },
    } as unknown as RawRecord)

    expect(acc.counts().byDay.get(UNDATED_DAY)?.user).toBe(1)
    expect([...acc.counts().byDay.keys()]).not.toContain('NaN-NaN-NaN')
  })
})
