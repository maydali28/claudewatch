#!/usr/bin/env node
/**
 * Semi-automated release script following gitflow:
 *
 * Usage:
 *   pnpm release          → bumps patch (0.7.2 → 0.7.3)
 *   pnpm release minor    → bumps minor (0.7.2 → 0.8.0)
 *   pnpm release major    → bumps major (0.7.2 → 1.0.0)
 *   pnpm release 1.2.3    → sets exact version
 *
 * Steps performed:
 *   1. Validate working tree is clean
 *   2. Confirm you're on a release/* or main branch
 *   3. Bump version in package.json
 *   4. Regenerate CHANGELOG.md (latest tag section only)
 *   5. Commit: chore(release): vX.Y.Z
 *   6. Tag: vX.Y.Z
 *   7. Print push instructions
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'
import { resolve } from 'path'

const root = resolve(import.meta.dirname, '..')
const pkgPath = resolve(root, 'package.json')

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: opts.pipe ? 'pipe' : 'inherit', ...opts }).trim()
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

function bumpVersion(current, bump) {
  const [maj, min, pat] = current.split('.').map(Number)
  if (bump === 'major') return `${maj + 1}.0.0`
  if (bump === 'minor') return `${maj}.${min + 1}.0`
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`
  // exact semver provided
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump
  throw new Error(`Invalid bump type: ${bump}`)
}

// ── Validate clean working tree ────────────────────────────────────────────
const status = run('git status --porcelain', { pipe: true })
if (status) {
  console.error('❌  Working tree is not clean. Commit or stash changes first.')
  process.exit(1)
}

// ── Validate branch ────────────────────────────────────────────────────────
const branch = run('git rev-parse --abbrev-ref HEAD', { pipe: true })
if (!branch.startsWith('release/') && branch !== 'main' && branch !== 'master') {
  console.warn(`⚠️  You are on branch "${branch}".`)
  console.warn('    Gitflow convention: releases should happen on release/* or main.')
  const ans = await prompt('Continue anyway? (y/N) ')
  if (ans.toLowerCase() !== 'y') process.exit(0)
}

// ── Resolve next version ───────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const bump = process.argv[2] || 'patch'
const nextVersion = bumpVersion(pkg.version, bump)
const tag = `v${nextVersion}`

console.log(`\n  Current: v${pkg.version}`)
console.log(`  Next:    ${tag}`)
console.log(`  Branch:  ${branch}\n`)

const confirm = await prompt(`Proceed with release ${tag}? (y/N) `)
if (confirm.toLowerCase() !== 'y') {
  console.log('Aborted.')
  process.exit(0)
}

// ── Bump package.json ──────────────────────────────────────────────────────
pkg.version = nextVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('✅  Bumped package.json')

// ── Regenerate CHANGELOG ───────────────────────────────────────────────────
run('pnpm changelog')
console.log('✅  Updated CHANGELOG.md')

// ── Commit & tag ───────────────────────────────────────────────────────────
run('git add package.json CHANGELOG.md')
run(`git commit -m "chore(release): ${tag}"`)
run(`git tag -a ${tag} -m "Release ${tag}"`)
console.log(`✅  Committed and tagged ${tag}`)

// ── Instructions ───────────────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Release ${tag} is ready locally.

 Next steps (gitflow):
   git push origin ${branch}
   git push origin ${tag}

 CI will build artifacts and publish the
 GitHub Release automatically.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
