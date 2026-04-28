#!/usr/bin/env node
// Generate update manifests (latest.yml, latest-linux.yml, latest-mac.json)
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
const repo = process.env.GITHUB_REPOSITORY

if (!dir || !version) {
  console.error('usage: generate-update-manifests.mjs --dir <path> --version <semver>')
  process.exit(1)
}
if (!repo) {
  console.error('GITHUB_REPOSITORY env var is required')
  process.exit(1)
}

const ghBase = `https://github.com/${repo}/releases/download/v${version}`
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
      `  - url: ${ghBase}/${winExe}`,
      `    sha512: ${sha512b64(winExe)}`,
      `    size: ${fileSize(winExe)}`,
      `path: ${ghBase}/${winExe}`,
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
    lines.push(`  - url: ${ghBase}/${f}`, `    sha512: ${sha512b64(f)}`, `    size: ${fileSize(f)}`)
  }
  lines.push(`releaseDate: '${now}'`)
  fs.writeFileSync(path.join(dir, 'latest-linux.yml'), lines.join('\n'))
}

// macOS — polled by in-app update check.
// We pin the SHA-512 of every macOS artifact so the client can verify
// the download before launching the installer. Without this pin the
// app would trust whatever bytes the update server hands back, which
// breaks our "verify what we ship" posture (see release-step
// "Verify uploaded artifact integrity" below for the same idea
// applied to the GitHub upload itself).
const macArtifacts = files.filter(
  (f) => /\.(dmg|zip)$/i.test(f) && /mac|darwin|arm64|x64/i.test(f)
)
const macArtifactsManifest = macArtifacts.map((f) => ({
  name: f,
  url: `${ghBase}/${f}`,
  sha512: sha512b64(f),
  size: fileSize(f),
}))
fs.writeFileSync(
  path.join(dir, 'latest-mac.json'),
  JSON.stringify({ version, releaseDate: now, artifacts: macArtifactsManifest }, null, 2)
)
