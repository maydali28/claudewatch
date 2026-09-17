/**
 * Strips home-directory paths and deep-walks Sentry payloads so no
 * machine-identifying path (username, home directory) reaches Sentry.
 */

// A path-segment name (the bit we redact) stops at the next path separator,
// at a quote/bracket/backtick character that can't legitimately appear
// inside a path segment, at ':' (so a trailing "file.ts:12:3" line/column
// suffix survives), and at a line-break/tab (so a scrub never reaches past
// the end of the line it started on and eats an unrelated next line or
// stack frame). Spaces stay allowed, so `John Smith` is still consumed in
// full — the accepted tradeoff is that `path C:\Users\bob is missing` loses
// the rest of that single line.
//
// An earlier "[user]" (from the known-name pass) counts as part of the
// segment, so a folder like "[user].CORP" or "John [user]" is consumed whole
// instead of stopping at the "]" and leaving ".CORP" or a stray "]" behind.
const NAME_TERMINATOR = String.raw`/\\'")\]>\r\n\t:\x60`
const NAME = String.raw`(?:\[user\]|[^${NAME_TERMINATOR}])+`

// Same idea for the segment inside an encoded Claude Code project-folder
// name (see the PATTERNS comment below), but hyphen-delimited instead of
// path-separator-delimited: stops at the next '-' as before, plus at real
// path separators, whitespace (including line breaks), quote/bracket
// characters, ':' and '.' — Claude Code's own encoding turns every one of
// those into a '-', so a genuine encoded-name segment never contains them;
// their presence means we've run past the encoded segment into a real,
// un-encoded suffix (e.g. "\s.jsonl" or "/index.json:12:3") that must
// survive untouched.
const ENCODED_TERMINATOR = String.raw`\-/\\\s'")\]>:.`
const ENCODED_NAME = String.raw`(?:\[user\]|[^${ENCODED_TERMINATOR}])+`

const MIN_KNOWN_NAME_LENGTH = 3

// Account names that are also everyday words in stack traces and messages
// ("node:internal/...", "node_modules", "app.asar", "root cause", "dev
// server", "test run"). Redacting them would destroy ordinary text, and they
// identify nobody, so they are never treated as known names. `claude` is here
// for a sharper reason: an account with that name would turn every `.claude`
// path segment — the paths a report most needs — into `.[user]`. The home
// folder of such an account is still removed by the path patterns.
// Compared case-insensitively.
const GENERIC_ACCOUNT_NAMES = new Set([
  'root',
  'node',
  'app',
  'user',
  'admin',
  'runner',
  'test',
  'dev',
  'guest',
  'ubuntu',
  'system',
  'claude',
])

// A known name only counts when no letter or digit touches it on either
// side, so "may" (from "mohamedali.may") never matches inside "Mayday".
const NOT_ALNUM_BEFORE = '(?<![A-Za-z0-9])'
const NOT_ALNUM_AFTER = '(?![A-Za-z0-9])'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds redaction patterns for known machine-identifying names (the OS
 * account name, the home-directory basename — see the `_knownNames` wiring in
 * sentry.ts). Each name contributes its literal form and its Claude
 * Code-encoded form (every character that isn't [A-Za-z0-9] replaced by '-',
 * matching how project folder names are built — see
 * src/shared/utils/decode-project-id.ts), both matched case-insensitively and
 * only as whole words. These run BEFORE PATTERNS: the generic
 * encoded-project-folder pattern stops at the first hyphen, so for the
 * account "mohamedali.may" it would turn "-Users-mohamedali-may-..." into
 * "-Users-[user]-may-..." and leave the whole-name match nothing to find.
 * Names shorter than 3 characters and generic account names are skipped.
 */
function knownNamePatterns(knownNames: readonly string[]): Array<[RegExp, string]> {
  const variants = new Map<string, string>()
  for (const name of knownNames) {
    if (name.length < MIN_KNOWN_NAME_LENGTH) continue
    if (GENERIC_ACCOUNT_NAMES.has(name.toLowerCase())) continue
    for (const variant of [name, name.replace(/[^A-Za-z0-9]/g, '-')]) {
      variants.set(variant.toLowerCase(), variant)
    }
  }
  // Longest first, so "john.CORP" is redacted whole before "john" can take
  // just its start and leave "-CORP" behind in an encoded folder name.
  return [...variants.values()]
    .sort((a, b) => b.length - a.length)
    .map((v): [RegExp, string] => [
      new RegExp(NOT_ALNUM_BEFORE + escapeRegExp(v) + NOT_ALNUM_AFTER, 'gi'),
      '[user]',
    ])
}

function applyPatterns(text: string, patterns: Array<[RegExp, string]>): string {
  return patterns.reduce((t, [re, rep]) => t.replace(re, rep), text)
}

// Skips a segment that is exactly "[user]" (from the known-name pass, or
// from an earlier scrub of the same string — captureMessage scrubs and then
// beforeSend scrubs again), so scrubText stays idempotent. A segment that
// only STARTS with "[user]" (e.g. "[user].CORP") is still redacted whole.
const NOT_REDACTED = String.raw`(?!\[user\](?:[${NAME_TERMINATOR}]|$))`
const NOT_REDACTED_ENCODED = String.raw`(?!\[user\](?:[${ENCODED_TERMINATOR}]|$))`

const PATTERNS: Array<[RegExp, string]> = [
  // POSIX (macOS /Users/, Linux /home/). Not anchored to a drive letter or
  // scheme, so this also catches e.g. file:///C:/Users/<n>/... and UNC-style
  // forward-slash forms. Case-insensitive and drive/prefix-agnostic.
  [new RegExp(String.raw`(/Users/)${NOT_REDACTED}${NAME}`, 'gi'), '$1[user]'],
  [new RegExp(String.raw`(/home/)${NOT_REDACTED}${NAME}`, 'gi'), '$1[user]'],
  // Windows backslash form. One or two backslashes on each side (a JSON- or
  // regex-escaped path doubles them), no drive-letter requirement — this
  // also matches UNC paths (`\\server\Users\<n>\...`) since the redacted
  // segment only needs a `\Users\` (or `\users\`) substring somewhere in the
  // string, not a specific prefix before it.
  [new RegExp(String.raw`(\\{1,2}Users\\{1,2})${NOT_REDACTED}${NAME}`, 'gi'), '$1[user]'],
  // Claude Code encodes ~/.claude/projects/<encoded> directory names by
  // replacing path separators with hyphens (see
  // src/shared/utils/decode-project-id.ts), so the home path is repeated a
  // second time, hyphen-joined, inside project paths — e.g.
  // "-home-bob-work", "-Users-bob-work", "C--Users-bob-work" (undecoded
  // Windows form) and "-C:-Users-bob-work" (this repo's decoded Windows
  // form) all contain a literal "-Users-" or "-home-" substring regardless
  // of what precedes it (drive letter, colon, extra hyphen, or nothing), so
  // one pattern per root covers all four encodings. The redacted segment
  // stops at the next hyphen (or real separator — see ENCODED_NAME above),
  // so a username containing a literal "-" is only partly recoverable —
  // accepted limitation, some signal beats none.
  [new RegExp(String.raw`(-Users-)${NOT_REDACTED_ENCODED}${ENCODED_NAME}`, 'gi'), '$1[user]'],
  [new RegExp(String.raw`(-home-)${NOT_REDACTED_ENCODED}${ENCODED_NAME}`, 'gi'), '$1[user]'],
]

/**
 * Replaces the user segment of home paths on all three platforms:
 * /Users/<n> → /Users/[user], /home/<n> → /home/[user],
 * C:\Users\<n> and C:/Users/<n> → C:\Users\[user] — plus the corresponding
 * encoded Claude Code project-folder segment. Matches lowercase drive
 * letters, `\\?\C:\Users\` long-path prefixes, UNC paths, and JSON-escaped
 * double backslashes (the regex isn't anchored to a drive letter, so it
 * finds `\Users\`/`/Users/` wherever they occur).
 *
 * `knownNames` (optional — omitting it, or passing `[]`, leaves behavior
 * unchanged) additionally redacts specific machine-identifying names, such
 * as the OS account name, that the path patterns above don't fully cover on
 * their own — see `knownNamePatterns`. Idempotent:
 * `scrubText(scrubText(x, n), n) === scrubText(x, n)`.
 */
export function scrubText(text: string, knownNames: readonly string[] = []): string {
  const afterNames =
    knownNames.length === 0 ? text : applyPatterns(text, knownNamePatterns(knownNames))
  return applyPatterns(afterNames, PATTERNS)
}

/** True only for plain `{}`/`Object.create(null)` objects — excludes Date, Error, typed arrays, etc. */
function isPlainObject(value: object): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * `copies` maps every array/object already visited to its scrubbed copy. The
 * copy is registered BEFORE its children are walked, so a cycle resolves to
 * the copy under construction (the cycle survives, inside the copy), and a
 * value reached a second time through another path gets the same scrubbed
 * copy. A plain visited set could only hand back the original there — which
 * left every repeated reference unscrubbed.
 */
function scrubDeepInternal<T>(
  value: T,
  copies: WeakMap<object, unknown>,
  knownNames: readonly string[]
): T {
  if (typeof value === 'string') return scrubText(value, knownNames) as T

  if (Array.isArray(value)) {
    if (copies.has(value)) return copies.get(value) as T
    const out: unknown[] = []
    copies.set(value, out)
    for (const v of value) out.push(scrubDeepInternal(v, copies, knownNames))
    return out as T
  }

  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    if (copies.has(value)) return copies.get(value) as T
    const out: Record<string, unknown> = {}
    copies.set(value, out)
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeepInternal(v, copies, knownNames)
    return out as T
  }

  // Not a string, array or plain object (Date, Error, typed array, RegExp,
  // null, number, ...) — return unchanged rather than guessing how to walk it.
  return value
}

/**
 * Deep-walks any JSON-like value and scrubs every string leaf. Returns a new
 * value; never mutates. A value reached more than once — shared or cyclic —
 * maps to one scrubbed copy, so sharing and cycles are preserved in the
 * result and no path back to an unscrubbed original survives. Non-plain
 * objects (Date, Error, typed arrays, ...) are preserved as-is rather than
 * walked.
 *
 * `knownNames` is forwarded to `scrubText` at every string leaf — see there.
 */
export function scrubDeep<T>(value: T, knownNames: readonly string[] = []): T {
  return scrubDeepInternal(value, new WeakMap(), knownNames)
}

/** scrubDeep applied to a Sentry event, typed. */
export function scrubEvent<E>(event: E, knownNames: readonly string[] = []): E {
  return scrubDeep(event, knownNames)
}
