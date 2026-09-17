import { describe, expect, it } from 'vitest'
import { scrubText, scrubDeep, scrubEvent } from './sentry-scrub'

describe('scrubText', () => {
  it.each([
    ['/Users/alice/Workspace/app/src/x.ts:1', '/Users/[user]/Workspace/app/src/x.ts:1'],
    [
      'at fn (/home/bob/.claude/projects/-home-bob-x/s.jsonl)',
      'at fn (/home/[user]/.claude/projects/-home-[user]-x/s.jsonl)',
    ],
    [
      'C:\\Users\\Carol\\AppData\\Local\\ClaudeWatch\\main.log',
      'C:\\Users\\[user]\\AppData\\Local\\ClaudeWatch\\main.log',
    ],
    ['file:///C:/Users/Carol/app.asar/main.js', 'file:///C:/Users/[user]/app.asar/main.js'],
    ['no paths here', 'no paths here'],
  ])('%s → %s', (i, o) => expect(scrubText(i)).toBe(o))

  it('matches a lowercase drive letter', () => {
    expect(scrubText('c:\\Users\\Dave\\file.log')).toBe('c:\\Users\\[user]\\file.log')
  })

  it('matches the \\\\?\\ long-path prefix', () => {
    expect(scrubText('\\\\?\\C:\\Users\\Carol\\AppData\\Local\\x')).toBe(
      '\\\\?\\C:\\Users\\[user]\\AppData\\Local\\x'
    )
  })

  // Claude Code encodes ~/.claude/projects/<encoded> directory names by
  // replacing path separators with hyphens, so the home path is repeated a
  // second time — as a hyphen-joined segment — inside project paths. A
  // username containing a literal "-" is only partly recoverable this way
  // (the redaction stops at the first hyphen after -Users-/-home-), which is
  // an accepted limitation: some signal beats none.
  it.each([
    ['-home-bob-work', '-home-[user]-work'], // Linux
    ['-Users-bob-work', '-Users-[user]-work'], // macOS
    ['C--Users-bob-work', 'C--Users-[user]-work'], // Windows (undecoded form)
    ['-C:-Users-bob-work', '-C:-Users-[user]-work'], // Windows (decode-project-id.ts form)
  ])('encoded project folder %s → %s', (i, o) => expect(scrubText(i)).toBe(o))

  it('redacts the encoded project folder segment embedded in a real path', () => {
    expect(scrubText('/home/bob/.claude/projects/-home-bob-x/s.jsonl')).toBe(
      '/home/[user]/.claude/projects/-home-[user]-x/s.jsonl'
    )
  })

  it('matches a name segment containing a space, stopping only at the path separator', () => {
    expect(scrubText('C:\\Users\\John Smith\\AppData\\x.log')).toBe(
      'C:\\Users\\[user]\\AppData\\x.log'
    )
    expect(scrubText('/Users/John Smith/app/x')).toBe('/Users/[user]/app/x')
  })

  it('matches a fully lower-case drive and "users" segment', () => {
    expect(scrubText('c:\\users\\bob\\x')).toBe('c:\\users\\[user]\\x')
  })

  it('matches a JSON-escaped (double-backslash) Windows path', () => {
    expect(scrubText('C:\\\\Users\\\\bob\\\\x')).toBe('C:\\\\Users\\\\[user]\\\\x')
  })

  it('matches a UNC path with no drive letter', () => {
    expect(scrubText('\\\\server\\Users\\bob\\x')).toBe('\\\\server\\Users\\[user]\\x')
  })

  it('stops at a closing quote instead of swallowing it', () => {
    expect(scrubText("open '/Users/bob'")).toBe("open '/Users/[user]'")
  })

  // Widening NAME to allow spaces (for "John Smith") also let it run through
  // line breaks, tabs and ':' — eating the rest of a stack trace, a
  // line/column suffix, or an unrelated next line. NAME now stops at those
  // too, while still allowing a plain space.
  it('keeps the /index.json:12:3 suffix after a home-root project folder', () => {
    expect(scrubText('/Users/bob/.claude/projects/-Users-bob/index.json:12:3')).toBe(
      '/Users/[user]/.claude/projects/-Users-[user]/index.json:12:3'
    )
  })

  it('keeps the \\s.jsonl suffix after the Windows encoded project folder form', () => {
    expect(scrubText('C:\\Users\\bob\\.claude\\projects\\C--Users-bob\\s.jsonl')).toBe(
      'C:\\Users\\[user]\\.claude\\projects\\C--Users-[user]\\s.jsonl'
    )
  })

  it('redacts each line of a multi-line message independently, keeping the next line intact', () => {
    expect(scrubText('failed for /home/bob\nnext line /home/alice/y')).toBe(
      'failed for /home/[user]\nnext line /home/[user]/y'
    )
  })

  it('keeps a trailing :line:col suffix', () => {
    expect(scrubText('at x (/Users/bob:10:5)')).toBe('at x (/Users/[user]:10:5)')
  })

  it('keeps a closing backtick', () => {
    expect(scrubText('path `/Users/bob` end')).toBe('path `/Users/[user]` end')
  })

  it('redacts a two-frame stack trace without eating the file, line/col or the next frame', () => {
    expect(
      scrubText(
        'at parse (/Users/bob/.claude/projects/-Users-bob/index.json:12:3)\n' +
          '    at load (/Users/bob/app/main.js:4:1)'
      )
    ).toBe(
      'at parse (/Users/[user]/.claude/projects/-Users-[user]/index.json:12:3)\n' +
        '    at load (/Users/[user]/app/main.js:4:1)'
    )
  })

  it('does not swallow an unrelated next line after a home path with no trailing separator', () => {
    expect(scrubText('cwd /Users/bob\n    at spawn (node:internal/child_process:420:11)')).toBe(
      'cwd /Users/[user]\n    at spawn (node:internal/child_process:420:11)'
    )
  })
})

// A real macOS account name can contain punctuation Claude Code's own
// project-folder encoding turns into '-' (e.g. the account
// "mohamedali.may" encodes to "...-mohamedali-may-..."). The generic
// encoded-project-folder pattern above stops at the first hyphen, so on its
// own it only redacts "mohamedali" and leaks "may". `knownNames` closes that
// gap by matching the literal name and its encoded form as whole words
// before the path patterns run.
describe('scrubText with knownNames', () => {
  const knownNames = ['mohamedali.may']

  it('redacts every trace of the account name from an encoded project-folder path (macOS/POSIX form)', () => {
    const out = scrubText(
      '/Users/mohamedali.may/.claude/projects/-Users-mohamedali-may-Workspace-x/s.jsonl',
      knownNames
    )
    expect(out).not.toMatch(/may/i)
    expect(out).not.toMatch(/mohamedali/i)
  })

  it('redacts every trace of the account name from the undecoded Windows encoded-folder form', () => {
    const out = scrubText('C--Users-mohamedali-may-work', knownNames)
    expect(out).not.toMatch(/may/i)
    expect(out).not.toMatch(/mohamedali/i)
  })

  it('redacts the literal account name inside plain prose', () => {
    expect(scrubText('reported by mohamedali.may today', knownNames)).toBe(
      'reported by [user] today'
    )
  })

  it('ignores a known name shorter than 3 characters', () => {
    expect(scrubText('the ab initio approach', ['ab'])).toBe('the ab initio approach')
  })

  it('escapes regex metacharacters in a known name instead of throwing', () => {
    expect(() => scrubText('found a+b.c here', ['a+b.c'])).not.toThrow()
    expect(scrubText('found a+b.c here', ['a+b.c'])).toBe('found [user] here')
  })

  it('leaves behavior unchanged when no knownNames are passed', () => {
    const text = '/Users/alice/Workspace/app/src/x.ts:1'
    expect(scrubText(text)).toBe(scrubText(text, []))
    expect(scrubText(text, [])).toBe('/Users/[user]/Workspace/app/src/x.ts:1')
  })
})

// A known name is matched only as a whole word (no letter or digit directly
// before or after it), so a name that shares letters with ordinary words
// never eats those words. Generic account names (root, node, ...) are skipped
// entirely because they are everyday words in stack traces.
describe('scrubText with knownNames keeps ordinary words', () => {
  const knownNames = ['mohamedali.may']

  it.each(['This may fail', 'Mayday', 'dismayed', 'Error: may not be null'])(
    'leaves %j unchanged',
    (text) => expect(scrubText(text, knownNames)).toBe(text)
  )

  it.each([
    [
      '/Users/mohamedali.may/.claude/projects/-Users-mohamedali-may-Workspace-x/s.jsonl:1:2',
      '/Users/[user]/.claude/projects/-Users-[user]-Workspace-x/s.jsonl:1:2',
    ],
    ['C--Users-mohamedali-may-work', 'C--Users-[user]-work'],
    ['-C:-Users-mohamedali-may-work', '-C:-Users-[user]-work'],
  ])('redacts %j to exactly %j', (input, expected) =>
    expect(scrubText(input, knownNames)).toBe(expected)
  )

  it('matches a short name only as a whole word', () => {
    expect(scrubText('Bobby', ['bob'])).toBe('Bobby')
    expect(scrubText('kabob and bobcat', ['bob'])).toBe('kabob and bobcat')
    expect(scrubText('johnson', ['john'])).toBe('johnson')
    expect(scrubText('rode a bob-sled', ['bob'])).toBe('rode a [user]-sled')
  })

  it('skips generic account names', () => {
    const text = 'at spawn (node:internal/child_process:420:11) in node_modules/x'
    expect(scrubText(text, ['node'])).toBe(text)
    expect(
      scrubText('Root cause: app user is admin on runner', [
        'ROOT',
        'app',
        'User',
        'admin',
        'runner',
      ])
    ).toBe('Root cause: app user is admin on runner')
  })

  it.each(['test', 'dev', 'guest', 'ubuntu', 'system', 'claude'])(
    'skips the generic account name %s',
    (name) => {
      const text = `the ${name} run failed in ${name}_helpers`
      expect(scrubText(text, [name])).toBe(text)
      expect(scrubText(text, [name.toUpperCase()])).toBe(text)
    }
  )

  it('keeps every .claude path intact for an account named claude', () => {
    // An account named `claude` would otherwise redact every `.claude` path
    // segment, and those are exactly the paths a report needs.
    expect(scrubText('read ./.claude/settings.json and .claude/projects', ['claude'])).toBe(
      'read ./.claude/settings.json and .claude/projects'
    )
    // The home folder itself is still removed, by the path patterns.
    expect(scrubText('/Users/claude/.claude/settings.json', ['claude'])).toBe(
      '/Users/[user]/.claude/settings.json'
    )
  })

  it.each([[[]], [['mohamedali.may']], [['bob']]])('is idempotent with knownNames %j', (names) => {
    const mixed =
      'may fail for mohamedali.may at /Users/mohamedali.may/app/x.js:3:4, ' +
      '/home/bob/.claude/projects/-home-bob-x/s.jsonl, C:\\Users\\Carol\\a.log, ' +
      'C--Users-mohamedali-may-work, -Users-alice-bob-x and bob-sled'
    const once = scrubText(mixed, names)
    expect(scrubText(once, names)).toBe(once)
  })
})

// The home folder name can be longer than the account name: Windows profile
// folders are often "john.CORP", "john.DESKTOP-AB12" or "john.000", so
// knownNames is ['john', 'john.CORP']. A known name that only covers the
// start of the folder name must not leave the rest of it behind.
describe('scrubText when a known name is only part of the home folder name', () => {
  const windows = ['john', 'john.CORP']

  it.each([
    [windows, 'C:\\Users\\john.CORP\\AppData\\x.js:1:2', 'C:\\Users\\[user]\\AppData\\x.js:1:2'],
    [['john'], 'C:\\Users\\john.CORP\\AppData\\x.js:1:2', 'C:\\Users\\[user]\\AppData\\x.js:1:2'],
    [windows, 'C:/Users/john.CORP/x', 'C:/Users/[user]/x'],
    [windows, 'C--Users-john-CORP-work', 'C--Users-[user]-work'],
    [['bob'], '/Users/bob-work/x', '/Users/[user]/x'],
    [['mohamedali.may'], '/Users/mohamedali.may.old/x', '/Users/[user]/x'],
    [['smith'], '/Users/John Smith/x', '/Users/[user]/x'],
    [[], '/Users/[user]x/y -Users-[user]x-z', '/Users/[user]/y -Users-[user]-z'],
  ])('with %j redacts %j to exactly %j, idempotently', (names, input, expected) => {
    const once = scrubText(input, names)
    expect(once).toBe(expected)
    expect(scrubText(once, names)).toBe(once)
  })
})

describe('scrubEvent', () => {
  it('reaches abs_path, module, message, breadcrumbs and extra', () => {
    const ev = {
      message: '/Users/a/x',
      exception: {
        values: [
          {
            value: '/home/b/y',
            stacktrace: {
              frames: [
                { filename: '/Users/a/f', abs_path: '/Users/a/f', module: 'C:\\Users\\c\\m' },
              ],
            },
          },
        ],
      },
      breadcrumbs: [{ message: '/home/b/z' }],
      extra: { p: ['/Users/a/q'] },
    }
    const out = scrubEvent(ev)
    expect(JSON.stringify(out)).not.toMatch(/\/Users\/a|\/home\/b|Users\\c/)
    expect(ev.message).toBe('/Users/a/x') // not mutated
  })
})

describe('scrubDeep', () => {
  it('does not recurse forever on a cyclic object, and keeps the cycle inside the copy', () => {
    const cyclic: Record<string, unknown> = { path: '/Users/a/x' }
    cyclic.self = cyclic
    const out = scrubDeep(cyclic) as Record<string, unknown>
    expect(out.path).toBe('/Users/[user]/x')
    // The cycle points at the scrubbed copy, never back at the unscrubbed
    // original (which still holds '/Users/a/x').
    expect(out.self).toBe(out)
    expect(out.self).not.toBe(cyclic)
  })

  it('does not recurse forever on a cyclic array, and keeps the cycle inside the copy', () => {
    const cyclic: unknown[] = ['/Users/a/x']
    cyclic.push(cyclic)
    const out = scrubDeep(cyclic) as unknown[]
    expect(out[0]).toBe('/Users/[user]/x')
    expect(out[1]).toBe(out)
    expect(out[1]).not.toBe(cyclic)
  })

  it('scrubs every occurrence of a value that appears more than once', () => {
    // The visited set used to record every object it had seen, not just the
    // ones on the current path, so the SECOND reference to a shared (but
    // acyclic) value came back as the unscrubbed original.
    const shared = { path: '/Users/alice/x' }
    const list = ['/home/bob/y']
    const out = scrubDeep({ a: shared, b: shared, c: list, d: [list] }) as {
      a: { path: string }
      b: { path: string }
      c: string[]
      d: string[][]
    }
    expect(out.a.path).toBe('/Users/[user]/x')
    expect(out.b.path).toBe('/Users/[user]/x')
    expect(out.c[0]).toBe('/home/[user]/y')
    expect(out.d[0][0]).toBe('/home/[user]/y')
    expect(JSON.stringify(out)).not.toMatch(/alice|bob/)
    // Sharing is preserved in the copy, and the input is untouched.
    expect(out.b).toBe(out.a)
    expect(shared.path).toBe('/Users/alice/x')
  })

  it('preserves a Date instance unchanged rather than walking it', () => {
    const date = new Date('2024-01-01T00:00:00.000Z')
    const out = scrubDeep({ when: date }) as { when: Date }
    expect(out.when).toBe(date)
  })

  it('preserves an Error instance unchanged rather than walking it', () => {
    const err = new Error('/Users/a/boom')
    const out = scrubDeep({ err }) as { err: Error }
    expect(out.err).toBe(err)
  })

  it('preserves a typed array unchanged rather than walking it', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const out = scrubDeep({ bytes }) as { bytes: Uint8Array }
    expect(out.bytes).toBe(bytes)
  })

  it('never mutates the input value', () => {
    const input = { nested: { p: '/Users/a/x' } }
    const snapshot = JSON.parse(JSON.stringify(input))
    scrubDeep(input)
    expect(input).toEqual(snapshot)
  })
})
