// Emit release notes for the most recent tag to stdout. Slices the first
// section out of CHANGELOG.md (everything after the leading '## <version>'
// heading, up to the next '## ' heading or EOF). Used by the release
// workflow so the GitHub release body matches what's already published in
// CHANGELOG.md for the same tag.
//
// Pure node — no npm deps — so the release job doesn't need devDependencies
// installed just to render release notes.
//
// Usage:
//   node scripts/extract-release-notes.mjs > release-notes.md

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8')

// Walk the file as a list of '## ...' sections and take the first one's body.
// The leading heading is dropped because GitHub renders the tag name as the
// release title above the body.
const sections = changelog.split(/^## /m).slice(1)
const first = sections[0] ?? ''
const body = first.replace(/^[^\n]*\n+/, '').trim()

process.stdout.write(body + '\n')
