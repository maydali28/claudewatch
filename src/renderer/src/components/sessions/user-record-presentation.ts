import type { UserRecordKind } from '@shared/types'

/**
 * How the transcript shows a `type: 'user'` record. Only a prompt a person
 * wrote is the user's blue bubble; Claude Code's own records get their own
 * collapsed cards. Local commands and the interrupt marker keep the bubble
 * path, which already turns their tags into pills.
 */
export type UserRecordVariant =
  'bubble' | 'task-notification' | 'agent-message' | 'injected-context'

export function userRecordVariant(kind: UserRecordKind | undefined): UserRecordVariant {
  switch (kind) {
    case 'task-notification':
      return 'task-notification'
    case 'agent-message':
      return 'agent-message'
    case 'meta':
      return 'injected-context'
    default:
      // `undefined` comes from a parse made before records carried a kind.
      return 'bubble'
  }
}

export const TASK_NOTIFICATION_LABEL = 'Background task finished'
export const TASK_NOTIFICATION_FALLBACK = 'Background task update'
export const AGENT_MESSAGE_LABEL = 'Sub-agent report'
export const INJECTED_CONTEXT_LABEL = 'Injected context'

const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/

/** The `<summary>` of a task notification, whitespace collapsed; undefined when absent or blank. */
export function extractTaskSummary(body: string): string | undefined {
  const match = SUMMARY_RE.exec(body)
  const summary = match?.[1].replace(/\s+/g, ' ').trim()
  return summary ? summary : undefined
}

export function taskNotificationTitle(body: string): string {
  return extractTaskSummary(body) ?? TASK_NOTIFICATION_FALLBACK
}

const AGENT_MESSAGE_RE = /<agent-message[^>]*>\n?([\s\S]*?)\n?<\/agent-message>/
const HANDBACK_FRAME_PREFIX = '[Subagent hand-back]'
const HARNESS_INDENT = '  '

/**
 * The report inside a sub-agent hand-back, without the harness frame.
 *
 * Claude Code writes a hand-back as a harness line, then the report inside
 * `<agent-message>`: a `[Subagent hand-back] …` frame line followed by the
 * report with every line indented by two spaces, then harness guidance after
 * the closing tag. Every hand-back in the measured history has that shape.
 * Anything else is returned as written.
 */
export function agentMessageBody(text: string): string {
  const match = AGENT_MESSAGE_RE.exec(text)
  if (!match) return text
  let lines = match[1].split('\n')
  if (lines[0]?.startsWith(HANDBACK_FRAME_PREFIX)) lines = lines.slice(1)
  const indented = lines.filter((l) => l.trim()).every((l) => l.startsWith(HARNESS_INDENT))
  if (indented) lines = lines.map((l) => l.slice(HARNESS_INDENT.length))
  return lines.join('\n').trim()
}

const AGENT_ID_CHARS = 8

export function shortAgentId(id: string | undefined): string | undefined {
  return id ? id.slice(0, AGENT_ID_CHARS) : undefined
}

const PREVIEW_CHARS = 80

/** First non-empty line of injected context, cut to a pill-sized preview. */
export function injectedContextPreview(text: string): string {
  const first =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  return first.length > PREVIEW_CHARS ? `${first.slice(0, PREVIEW_CHARS)}…` : first
}

/**
 * Whether a card's hidden text contains the in-session search query. The
 * panel keeps a record when its text matches (`session-panel.tsx`), so a
 * collapsed card opens itself on a match — otherwise the hit is invisible.
 */
export function textMatchesQuery(text: string, query: string): boolean {
  if (!query) return false
  return text.toLowerCase().includes(query.toLowerCase())
}
