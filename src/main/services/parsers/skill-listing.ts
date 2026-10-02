import type { RawRecord, SkillListingEntry } from '@shared/types/session'

// Claude Code records the skills it loaded for a session as `attachment`
// records of type `skill_listing`: one at session start with the full list
// (`isInitial: true`) and later deltas that only add names. `names` holds the
// skill names (`humanizer`, `superpowers:brainstorming`,
// `anthropic-skills:docx`, built-ins such as `code-review`) and `content` one
// `- name: description` line per skill. This is the only record of skills
// that have no file on disk (built-in and claude.ai skills).

/** Long descriptions are cut so the per-session metadata cache stays small. */
const MAX_DESCRIPTION = 300

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function descriptionsOf(content: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof content !== 'string') return out
  for (const line of content.split('\n')) {
    // A name may itself contain ':' (`plugin:skill`), never ': '.
    const m = line.match(/^- (.+?): (.*)$/)
    if (!m) continue
    const text = m[2].trim()
    if (!text) continue
    out.set(m[1], text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text)
  }
  return out
}

export interface SkillListingCollector {
  add(raw: RawRecord): void
  /** Every skill name seen, in first-seen order, with the first description seen. */
  result(): SkillListingEntry[]
  /** As `result`, or undefined when the session recorded no skill listing. */
  resultOrUndefined(): SkillListingEntry[] | undefined
}

export function createSkillListingCollector(): SkillListingCollector {
  const skills = new Map<string, string | undefined>()

  return {
    add(raw) {
      if (raw.type !== 'attachment' || !isPlainObject(raw.attachment)) return
      const { type, names, content } = raw.attachment
      if (type !== 'skill_listing' || !Array.isArray(names)) return
      const descriptions = descriptionsOf(content)
      for (const name of names) {
        if (typeof name !== 'string' || !name || skills.has(name)) continue
        skills.set(name, descriptions.get(name))
      }
    },
    result() {
      return [...skills].map(([name, description]) =>
        description ? { name, description } : { name }
      )
    },
    resultOrUndefined() {
      return skills.size > 0 ? this.result() : undefined
    },
  }
}
