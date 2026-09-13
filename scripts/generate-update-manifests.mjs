#!/usr/bin/env node
// Generate update manifests (latest.yml, latest-linux.yml, latest-mac.yml)
// for a release. Reads artifacts from --dir, writes manifests back into the
// same dir.
//
// Usage:
//   node scripts/generate-update-manifests.mjs --dir release-files --version 1.2.3
//
// GITHUB_REPOSITORY env var must be set (GitHub Actions sets it automatically).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const dir = arg('dir')
const version = arg('version')

if (!dir || !version) {
  console.error('usage: generate-update-manifests.mjs --dir <path> --version <semver>')
  process.exit(1)
}
// electron-updater treats `url` and `path` in these manifests as file NAMES,
// not URLs: its provider builds the download link itself from the release base
// plus the tag, then appends this value. Emitting an absolute URL here made it
// concatenate the two and 404:
//
//   .../releases/download/v1.2.4/https://github.com/.../ClaudeWatch-...zip
//
// electron-builder, whose format these files imitate, writes bare filenames.
const files = fs.readdirSync(dir)
const now = new Date().toISOString()

function sha512b64(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(path.join(dir, file))).digest('base64')
}
function fileSize(file) {
  return fs.statSync(path.join(dir, file)).size
}

// Windows — electron-updater
const winExe = files.find((f) => /Setup\.exe$/i.test(f)) || files.find((f) => /\.exe$/i.test(f))
if (winExe) {
  fs.writeFileSync(
    path.join(dir, 'latest.yml'),
    [
      `version: ${version}`,
      `files:`,
      `  - url: ${winExe}`,
      `    sha512: ${sha512b64(winExe)}`,
      `    size: ${fileSize(winExe)}`,
      `path: ${winExe}`,
      `sha512: ${sha512b64(winExe)}`,
      `releaseDate: '${now}'`,
    ].join('\n')
  )
}

// Linux — electron-updater
const linuxPkgs = files.filter((f) => /\.(deb|rpm)$/.test(f))
if (linuxPkgs.length) {
  const lines = [`version: ${version}`, `files:`]
  for (const f of linuxPkgs) {
    lines.push(`  - url: ${f}`, `    sha512: ${sha512b64(f)}`, `    size: ${fileSize(f)}`)
  }
  lines.push(`releaseDate: '${now}'`)
  fs.writeFileSync(path.join(dir, 'latest-linux.yml'), lines.join('\n'))
}

// macOS — electron-updater (Squirrel.Mac), same generic feed as Windows/Linux.
// The signed + notarized .zip is the auto-update payload; the .dmg is for fresh
// installs only, so the manifest references the zip. electron-updater fetches
// latest-mac.yml from the feed, verifies the sha512 pinned below before applying
// the download, and Squirrel.Mac additionally requires a valid Developer ID
// signature. We pin every artifact's SHA-512 to keep our "verify what we ship"
// posture (see the "Verify uploaded artifact integrity" release step for the
// same idea applied to the GitHub upload itself).
//
// CI builds one arch per release (the macos runner's native arch), so `files`
// normally holds a single zip. If a multi-arch build ever lands here, every zip
// is listed and electron-updater selects the one matching the running arch.
//
// Match the macOS zip by its `darwin`/`mac`/`osx` token and explicitly exclude
// the Windows zip — forge names it `...-win32-x64-...zip`, whose bare `x64`
// would otherwise be mistaken for a mac arch and listed as a mac update file.
// (Exclude on `win32`/`windows`, not bare `win` — "darwin" itself ends in "win".)
const macZips = files.filter(
  (f) => /\.zip$/i.test(f) && /(darwin|osx|mac)/i.test(f) && !/win32|windows/i.test(f)
)
if (macZips.length) {
  const lines = [`version: ${version}`, `files:`]
  for (const f of macZips) {
    lines.push(`  - url: ${f}`, `    sha512: ${sha512b64(f)}`, `    size: ${fileSize(f)}`)
  }
  // `path` + top-level `sha512` are the legacy single-file pointer electron-updater
  // still reads; point them at the first (host-arch) zip.
  const primary = macZips[0]
  lines.push(`path: ${primary}`, `sha512: ${sha512b64(primary)}`, `releaseDate: '${now}'`)
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), lines.join('\n'))
}
