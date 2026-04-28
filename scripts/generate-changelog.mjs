import { ConventionalChangelog } from 'conventional-changelog'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const OUTFILE = resolve('CHANGELOG.md')
const regenerateAll = process.argv.includes('--all')

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
