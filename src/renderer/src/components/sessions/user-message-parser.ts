export interface ParsedContextTag {
  tag: string
  label: string
  content: string
  filePath?: string
  kind: 'file' | 'selection' | 'reminder' | 'command' | 'generic'
}

export interface ParsedUserMessage {
  mainText: string
  contextTags: ParsedContextTag[]
}

const TAG_META: Record<string, { label: string; kind: ParsedContextTag['kind'] }> = {
  ide_opened_file: { label: 'Opened file', kind: 'file' },
  ide_selection: { label: 'Selection', kind: 'selection' },
  system_reminder: { label: 'System reminder', kind: 'reminder' },
  'system-reminder': { label: 'System reminder', kind: 'reminder' },
  command_name: { label: 'Command', kind: 'command' },
  'command-name': { label: 'Command', kind: 'command' },
}

function extractFilePath(content: string, tag: string): string | undefined {
  if (tag === 'ide_opened_file') {
    // Content is usually just the file path
    const trimmed = content.trim()
    if (trimmed && !trimmed.includes('\n')) return trimmed
    // Multi-line: first line may be the path
    const first = trimmed.split('\n')[0].trim()
    if (first) return first
  }
  if (tag === 'ide_selection') {
    // "The user opened the file /path/to/file" pattern
    const m =
      content.match(/opened the file\s+([^\s]+)/i) ?? content.match(/([/~][^\s]+\.[a-zA-Z]+)/)
    return m?.[1]
  }
  return undefined
}

export function parseUserMessage(raw: string): ParsedUserMessage {
  // Match opening + optional content + closing tags (multi-line, non-greedy)
  const TAG_RE = /<([\w-]+)>([\s\S]*?)<\/\1>/g

  const contextTags: ParsedContextTag[] = []
  let mainText = raw

  let match: RegExpExecArray | null
  // Collect all matches first, then remove them from mainText
  const replacements: Array<{ full: string; tag: ParsedContextTag }> = []

  TAG_RE.lastIndex = 0
  while ((match = TAG_RE.exec(raw)) !== null) {
    const [full, tagName, content] = match
    const meta = TAG_META[tagName] ?? {
      label: tagName.replace(/[-_]/g, ' '),
      kind: 'generic' as const,
    }
    const filePath = extractFilePath(content, tagName)
    replacements.push({
      full,
      tag: {
        tag: tagName,
        label: meta.label,
        content: content.trim(),
        filePath,
        kind: meta.kind,
      },
    })
  }

  for (const { full, tag } of replacements) {
    contextTags.push(tag)
    mainText = mainText.replace(full, '')
  }

  // Also strip self-closing context injections like bare text injected by the harness
  mainText = mainText.trim()

  return { mainText, contextTags }
}
