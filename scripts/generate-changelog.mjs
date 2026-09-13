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

const generator = new ConventionalChangelog()
  .readPackage()
  .readRepository()
  .loadPreset('conventionalcommits')
  .writer({
    headerPartial: '## {{version}}{{#if title}} "{{title}}"{{/if}}{{#if date}} ({{date}}){{/if}}\n\n',
    commitPartial: '*{{#if scope}} **{{scope}}:**{{/if}} {{subject}}\n'
  })

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
