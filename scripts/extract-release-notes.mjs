// Emit release notes for the most recent tag to stdout, matching the format
// `pnpm changelog` writes to CHANGELOG.md. Used by the release workflow so
// awk-slicing CHANGELOG.md (which broke on stray '## ' headings inside a
// release body) is no longer in the critical path.
//
// Usage:
//   node scripts/extract-release-notes.mjs > release-notes.md

import { ConventionalChangelog } from 'conventional-changelog'

const generator = new ConventionalChangelog()
  .readPackage()
  .readRepository()
  .loadPreset('conventionalcommits')
  .options({ releaseCount: 1 })
  .writer({
    // Mirror generate-changelog.mjs so the body matches what users already
    // see in CHANGELOG.md for the same tag.
    headerPartial: '## {{version}}{{#if title}} "{{title}}"{{/if}}{{#if date}} ({{date}}){{/if}}\n\n',
    commitPartial: '*{{#if scope}} **{{scope}}:**{{/if}} {{subject}}\n',
  })

let body = ''
for await (const chunk of generator.write()) {
  body += chunk
}

// Strip the leading '## <version> (<date>)' header — GitHub renders the tag
// name as the release title above the body, so repeating it here is noise.
const stripped = body.replace(/^##[^\n]*\n+/, '').trim()

process.stdout.write(stripped + '\n')
