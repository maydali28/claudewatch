#!/usr/bin/env node
// Packaged-build smoke test for preferences load.
//
// electron-store v10 is ESM-only and our main process bundles to CJS via
// electron-vite's `externalizeDepsPlugin`. The preferences module loads it via
// dynamic `import()` to bridge that gap; if anything regresses (someone
// switches back to a static import, or the bundler swallows the ESM hint), the
// app silently fails to launch. This script boots the real built
// `out/main/index.js` against an isolated user-data dir, watches for the
// "FileWatcher started" log line that bootstrap emits *after*
// `Preferences.load()` completes, and fails loudly on timeout or any
// uncaught/unhandled error log.
//
// Wire into CI right after `pnpm build`:
//   pnpm build && node scripts/smoke-preferences.mjs
//
// Exit code: 0 on success, non-zero on any failure.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const builtMain = join(repoRoot, 'out', 'main', 'index.js')

if (!existsSync(builtMain)) {
  console.error('FAIL out/main/index.js missing — run `pnpm build` first.')
  process.exit(2)
}

const electronBin = join(repoRoot, 'node_modules', '.bin', 'electron')
if (!existsSync(electronBin)) {
  console.error('FAIL electron binary missing — run `pnpm install` first.')
  process.exit(2)
}

// Isolated user-data dir so we never trample the developer's real preferences.
const tmpUserData = mkdtempSync(join(tmpdir(), 'claudewatch-smoke-'))

const READY_MARKER = 'FileWatcher started'
const TIMEOUT_MS = 30_000
let satisfied = false

// --no-sandbox: CI runners (GitHub Actions ubuntu-latest) ship Electron's
// chrome-sandbox without the setuid bit, which aborts launch. This smoke test
// only exercises main-process bootstrap, so the sandbox adds no value.
const child = spawn(electronBin, [builtMain, `--user-data-dir=${tmpUserData}`, '--no-sandbox'], {
  env: {
    ...process.env,
    // The smoke test isn't a CI display test — disable the GPU so it works on
    // headless runners without xvfb.
    ELECTRON_DISABLE_GPU: '1',
    CLAUDEWATCH_SMOKE: '1',
  },
})

let buffered = ''
function onData(chunk) {
  const text = chunk.toString()
  buffered += text
  process.stdout.write(text)
  if (!satisfied && buffered.includes(READY_MARKER)) {
    satisfied = true
    console.log('\nsmoke-preferences: OK — Preferences.load() completed without throwing.')
    child.kill('SIGTERM')
  }
  // Treat the global error guards we wired in 4.4 as fatal during smoke.
  if (buffered.match(/Unhandled (uncaughtException|unhandledRejection)/)) {
    console.error('\nsmoke-preferences: FAIL — main process logged an unhandled error.')
    child.kill('SIGTERM')
    cleanup(1)
  }
}
child.stdout.on('data', onData)
child.stderr.on('data', onData)

const timer = setTimeout(() => {
  console.error(`\nsmoke-preferences: FAIL — did not see "${READY_MARKER}" within ${TIMEOUT_MS}ms.`)
  child.kill('SIGKILL')
  cleanup(1)
}, TIMEOUT_MS)

child.on('exit', (code, signal) => {
  clearTimeout(timer)
  if (satisfied) {
    cleanup(0)
  } else {
    console.error(`\nsmoke-preferences: FAIL — main exited (code=${code}, signal=${signal}) before readiness.`)
    cleanup(1)
  }
})

function cleanup(exitCode) {
  try {
    rmSync(tmpUserData, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
  process.exit(exitCode)
}
