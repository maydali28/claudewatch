#!/usr/bin/env node
/**
 * Bundle size gate — keeps the renderer from silently bloating between PRs.
 *
 * Walks `out/renderer/assets` after a build and compares the gzipped size of
 * each entry chunk plus the total against budgets defined below. Exits 1 on
 * any breach with a diff vs. the budget so CI fails fast.
 *
 * To raise a budget: bump the number here, mention the reason in the commit,
 * and ideally add a follow-up to bring it back down. Do NOT silently raise.
 */

import { promises as fs } from 'node:fs'
import { gzipSync } from 'node:zlib'
import * as path from 'node:path'

// Budgets are gzipped bytes — what users actually download. A budget of 0
// disables the per-file check (only the total is enforced).
const BUDGETS = {
  total: 1_400_000, // 1.4 MB gzipped — full renderer payload across all entries
  perEntry: {
    // Largest entry first for easier scanning — these will tighten as the
    // app stabilises. Keys match the asset filename prefix produced by Vite
    // (before the content hash).
    'app-': 900_000,
    'tray-app-': 250_000,
    'about-app-': 150_000,
    'update-app-': 150_000,
    'onboarding-app-': 200_000,
  },
}

const ASSETS_DIR = path.resolve(process.cwd(), 'out/renderer/assets')

async function listAssets() {
  try {
    const files = await fs.readdir(ASSETS_DIR)
    return files.filter((f) => f.endsWith('.js') || f.endsWith('.css'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`No build output at ${ASSETS_DIR}. Run 'pnpm build' first.`)
      process.exit(2)
    }
    throw err
  }
}

async function gzippedSize(file) {
  const buf = await fs.readFile(path.join(ASSETS_DIR, file))
  return gzipSync(buf).length
}

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

async function main() {
  const files = await listAssets()
  const sizes = await Promise.all(files.map(async (f) => ({ file: f, gzip: await gzippedSize(f) })))
  sizes.sort((a, b) => b.gzip - a.gzip)

  const breaches = []
  let total = 0
  for (const { file, gzip } of sizes) {
    total += gzip
    for (const [prefix, budget] of Object.entries(BUDGETS.perEntry)) {
      if (file.startsWith(prefix) && budget > 0 && gzip > budget) {
        breaches.push(`  ${file}: ${fmt(gzip)} > budget ${fmt(budget)}`)
      }
    }
  }
  if (total > BUDGETS.total) {
    breaches.push(`  total renderer: ${fmt(total)} > budget ${fmt(BUDGETS.total)}`)
  }

  console.log('Renderer bundle (gzipped):')
  for (const { file, gzip } of sizes) console.log(`  ${file.padEnd(50)} ${fmt(gzip)}`)
  console.log(`  ${'─'.repeat(50)}`)
  console.log(`  ${'TOTAL'.padEnd(50)} ${fmt(total)} / ${fmt(BUDGETS.total)}`)

  if (breaches.length > 0) {
    console.error('\nBundle size budget breached:')
    for (const b of breaches) console.error(b)
    console.error(
      '\nIf this growth is intentional, raise the budget in scripts/check-bundle-size.mjs.'
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
