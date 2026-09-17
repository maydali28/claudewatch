import { describe, expect, it } from 'vitest'
import {
  userRecordVariant,
  taskNotificationTitle,
  extractTaskSummary,
  agentMessageBody,
  shortAgentId,
  injectedContextPreview,
  textMatchesQuery,
} from './user-record-presentation'

describe('userRecordVariant', () => {
  it.each([
    ['prompt', 'bubble'],
    [undefined, 'bubble'],
    ['local-command', 'bubble'],
    ['interrupt', 'bubble'],
    ['task-notification', 'task-notification'],
    ['agent-message', 'agent-message'],
    ['meta', 'injected-context'],
  ] as const)('shows a %s record as %s', (kind, variant) => {
    expect(userRecordVariant(kind)).toBe(variant)
  })
})

// Shape of a real notification (September 2026), paths redacted.
const notification = `<task-notification>
<task-id>a35e2511de91949d1</task-id>
<tool-use-id>toolu_01</tool-use-id>
<output-file>/tmp/tasks/a35e2511de91949d1.output</output-file>
<status>completed</status>
<summary>Agent "Research updater code paths" finished</summary>
<note>A task-notification fires each time this agent stops.</note>
</task-notification>`

describe('task notification text', () => {
  it('reads the summary out of the notification body', () => {
    expect(extractTaskSummary(notification)).toBe('Agent "Research updater code paths" finished')
    expect(taskNotificationTitle(notification)).toBe('Agent "Research updater code paths" finished')
  })

  it('collapses whitespace inside the summary', () => {
    expect(extractTaskSummary('<summary>\n  Build   done\n</summary>')).toBe('Build done')
  })

  it('falls back when the body has no summary, or an empty one', () => {
    expect(
      extractTaskSummary('<task-notification><status>killed</status></task-notification>')
    ).toBe(undefined)
    expect(taskNotificationTitle('<task-notification></task-notification>')).toBe(
      'Background task update'
    )
    expect(taskNotificationTitle('<summary>   </summary>')).toBe('Background task update')
  })
})

// Shape of a real hand-back (September 2026): a harness line, the framed
// report indented by two spaces, then harness guidance after the close tag.
const handBack = `Another Claude session sent a message:
<agent-message from="a35e2511de91949d1">
[Subagent hand-back] The text below is the final report of a subagent. The report follows:
  # Updater map

  - step one
    - nested
</agent-message>

That "other Claude session" is an agent working inside this same session.`

describe('agentMessageBody', () => {
  it('keeps only the report, without the harness frame, dedented', () => {
    expect(agentMessageBody(handBack)).toBe('# Updater map\n\n- step one\n  - nested')
  })

  it('returns the text as is when the frame is not recognisable', () => {
    expect(agentMessageBody('Another Claude session sent a message:\nhello')).toBe(
      'Another Claude session sent a message:\nhello'
    )
  })

  it('keeps an unframed message body inside the tag without dedenting unindented lines', () => {
    expect(agentMessageBody('<agent-message from="x">\nplain\n  indented\n</agent-message>')).toBe(
      'plain\n  indented'
    )
  })
})

describe('shortAgentId', () => {
  it('shows the first eight characters', () => {
    expect(shortAgentId('a35e2511de91949d1')).toBe('a35e2511')
  })

  it('shows nothing for a missing id', () => {
    expect(shortAgentId(undefined)).toBeUndefined()
    expect(shortAgentId('')).toBeUndefined()
  })
})

describe('injectedContextPreview', () => {
  it('shows the first non-empty line', () => {
    expect(injectedContextPreview('\n\nBase directory for this skill: /x\n\n# Skill')).toBe(
      'Base directory for this skill: /x'
    )
  })

  it('truncates a long first line', () => {
    const preview = injectedContextPreview('x'.repeat(200))
    expect(preview.length).toBeLessThanOrEqual(81)
    expect(preview.endsWith('…')).toBe(true)
  })
})

describe('textMatchesQuery', () => {
  it('matches case-insensitively and ignores an empty query', () => {
    expect(textMatchesQuery('Updater Map', 'updater')).toBe(true)
    expect(textMatchesQuery('Updater Map', 'missing')).toBe(false)
    expect(textMatchesQuery('Updater Map', '')).toBe(false)
  })
})
