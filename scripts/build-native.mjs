#!/usr/bin/env node
// Builds the macOS notification-permission addon (native/notification-status)
// into out/native/, which ships unpacked beside app.asar. A no-op elsewhere:
// the app only loads it on macOS and falls back without it.
//
// Node-API is stable across Node and Electron versions, so the headers of the
// Node running this script are enough. Universal (arm64 + x86_64).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'native/notification-status/notification_status.m')
const output = path.join(root, 'out/native/notification-status.node')
const headers = path.resolve(path.dirname(process.execPath), '..', 'include', 'node')

if (!existsSync(path.join(headers, 'node_api.h'))) {
  console.error(`build-native: node_api.h not found in ${headers}`)
  process.exit(1)
}
mkdirSync(path.dirname(output), { recursive: true })
execFileSync(
  'clang',
  [
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-fobjc-arc',
    '-O2',
    '-arch',
    'arm64',
    '-arch',
    'x86_64',
    '-mmacosx-version-min=11.0',
    '-DNAPI_VERSION=8',
    '-I',
    headers,
    '-framework',
    'Foundation',
    '-framework',
    'UserNotifications',
    source,
    '-o',
    output,
  ],
  { stdio: 'inherit' }
)
console.log(`build-native: ${path.relative(root, output)}`)
