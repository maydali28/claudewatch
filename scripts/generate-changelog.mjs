import { ConventionalChangelog } from 'conventional-changelog'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const OUTFILE = resolve('CHANGELOG.md')
const regenerateAll = process.argv.includes('--all')

/**
 * Where to start collecting commits, as `--from <ref>`.
 *
 * Release tags are created on the merge commit on `main`, which is never an
 * ancestor of `develop`. So on a branch cut from develop the newest reachable
 * tag is several releases old, and the generated section repeats every entry
 * released since. Pass the ref the last release actually shipped from — the
 * develop-side commit — and the section covers only what is new.
 */
const fromIndex = process.argv.indexOf('--from')
const from = fromIndex === -1 ? undefined : process.argv[fromIndex + 1]

if (fromIndex !== -1 && !from) {
  console.error('--from needs a git ref, e.g. --from origin/develop~1')
  process.exit(1)
}

/**
 * Section layout — byte-for-byte what conventional-changelog 7 produced, so
 * every section of CHANGELOG.md reads the same and extract-release-notes.mjs
 * and the release hook keep parsing it:
 *
 *   ## <version> (<date>)
 *   <blank>
 *   <blank>
 *   ### ⚠ BREAKING CHANGES        (only when a commit carries one)
 *   <blank>
 *   * **<scope>:** <note>
 *   <blank>
 *   ### <group>
 *   <blank>
 *   * **<scope>:** <subject>
 *
 * conventional-changelog 8 renders through template functions instead of
 * Handlebars strings. These are the same two overrides as before (plain
 * version in the heading, subject only on each line — commit subjects are
 * the release notes, so no hash or compare links), plus the enclosing
 * template: the writer trims every segment, so the second blank line after
 * the heading cannot come from the header partial any more.
 */
function headerPartial({ version, title, date }) {
  return `## ${version}${title ? ` "${title}"` : ''}${date ? ` (${date})` : ''}`
}

function commitPartial(_context, { scope, subject, header }) {
  return `${scope ? `**${scope}:** ` : ''}${subject || header || ''}`
}

function bullets(items) {
  return items.map((item) => `* ${item}`).join('\n')
}

function template(context) {
  const { noteGroups = [], commitGroups = [] } = context
  const blocks = [
    ...noteGroups.map(
      (group) =>
        `### ⚠ ${group.title}\n\n${bullets(
          group.notes.map(
            (note) => `${note.commit?.scope ? `**${note.commit.scope}:** ` : ''}${note.text}`
          )
        )}`
    ),
    ...commitGroups.map(
      (group) =>
        `${group.title ? `### ${group.title}\n\n` : ''}${bullets(
          group.commits.map((commit) => commitPartial(context, commit))
        )}`
    ),
  ]
  return `${headerPartial(context)}\n\n\n${blocks.join('\n\n')}`
}

const generator = new ConventionalChangelog()
  .readPackage()
  .readRepository()
  .loadPreset('conventionalcommits')
  .writer({ template, headerPartial, commitPartial })

if (regenerateAll) {
  generator.options({ releaseCount: 0 })
}

if (from) {
  generator.commits({ from })
}

let newContent = ''
for await (const chunk of generator.write()) {
  newContent += chunk
}

if (regenerateAll || !existsSync(OUTFILE)) {
  await writeFile(OUTFILE, newContent, 'utf8')
} else {
  const existing = await readFile(OUTFILE, 'utf8')
  await writeFile(OUTFILE, newContent + existing, 'utf8')
}
