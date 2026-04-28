#!/usr/bin/env node
/**
 * Assembles a signed APT repository tree from .deb files so users can run
 * `sudo apt install claudewatch` after adding the repo as a source.
 *
 * Usage (typically called from CI):
 *   node scripts/build-apt-repo.mjs \
 *     --debs <dir-or-file>          # location of .deb artifacts (recursed)
 *     --out  <dir>                  # output dir (becomes the repo root)
 *     --gpg-key-id <id>             # GPG key used to sign Release/InRelease
 *     [--origin    ClaudeWatch]
 *     [--label     ClaudeWatch]
 *     [--suite     stable]
 *     [--component main]
 *
 * Layout produced under <out>:
 *
 *   pool/<component>/c/claudewatch/claudewatch_<ver>_<arch>.deb
 *   dists/<suite>/<component>/binary-<arch>/Packages
 *   dists/<suite>/<component>/binary-<arch>/Packages.gz
 *   dists/<suite>/Release
 *   dists/<suite>/Release.gpg     (detached signature)
 *   dists/<suite>/InRelease       (inline-signed Release)
 *   pubkey.gpg                    (ASCII-armored public key)
 *
 * Architectures are discovered from the .deb filenames themselves, so the
 * same script works for amd64, arm64, and future cross-builds without a
 * config change.
 *
 * Requires `dpkg-scanpackages`, `apt-ftparchive`, `gzip`, and `gpg` on PATH.
 * The matching private key must already be imported into the local GPG
 * keyring (the CI workflow imports it from a secret before invoking this).
 *
 * Security notes:
 *   - All subprocess calls go through execFileSync with arg arrays. No user
 *     input is ever interpolated into a shell string, so no shell-injection
 *     risk even if --suite/--component/etc. ever get fed untrusted values.
 *   - The GPG passphrase, if set in APT_GPG_PASSPHRASE, is passed via stdin
 *     (--passphrase-fd 0) so it never appears in argv or process listings.
 */

import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'fs'
import { resolve, basename, join } from 'path'

// ── Argument parsing ──────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = process.argv[i + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} requires a value`)
  }
  return value
}

const debsInput  = arg('debs')
const outDirArg  = arg('out')
const gpgKeyId   = arg('gpg-key-id')
const origin     = arg('origin', 'ClaudeWatch')
const label      = arg('label', 'ClaudeWatch')
const suite      = arg('suite', 'stable')
const component  = arg('component', 'main')

if (!debsInput || !outDirArg || !gpgKeyId) {
  console.error('usage: build-apt-repo.mjs --debs <dir> --out <dir> --gpg-key-id <id>')
  process.exit(1)
}

const outDir = resolve(outDirArg)

// Allow only conservative characters in identifiers that end up in metadata
// or paths, so a misconfigured CI value can't break the layout or smuggle
// shell metacharacters even into log output.
const SAFE = /^[A-Za-z0-9._-]+$/
for (const [name, value] of Object.entries({ origin, label, suite, component, gpgKeyId })) {
  if (!SAFE.test(value)) {
    console.error(`invalid value for --${name}: ${value} (must match ${SAFE})`)
    process.exit(1)
  }
}

// ── Subprocess helpers ────────────────────────────────────────────────────
function exec(file, args, opts = {}) {
  return execFileSync(file, args, {
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    ...opts,
  })
}

function execWithStdin(file, args, stdin, opts = {}) {
  return execFileSync(file, args, {
    input: stdin,
    stdio: ['pipe', opts.capture ? 'pipe' : 'inherit', 'inherit'],
    encoding: 'utf8',
    ...opts,
  })
}

// ── Discover .deb files ───────────────────────────────────────────────────
function findDebs(input) {
  const path = resolve(input)
  if (!existsSync(path)) throw new Error(`debs path not found: ${path}`)
  if (statSync(path).isFile()) {
    return path.endsWith('.deb') ? [path] : []
  }
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (entry.endsWith('.deb')) out.push(full)
    }
  }
  walk(path)
  return out
}

const incomingDebs = findDebs(debsInput)
if (incomingDebs.length === 0) {
  console.error(`no .deb files found under ${debsInput}`)
  process.exit(1)
}

// ── Stage incoming .deb files into the pool ───────────────────────────────
// Layout: pool/<component>/c/claudewatch/<file>.deb
// (Debian convention: first letter of the source package name is the
// second-level directory.)
const poolDir = join(outDir, 'pool', component, 'c', 'claudewatch')
mkdirSync(poolDir, { recursive: true })

for (const src of incomingDebs) {
  const dest = join(poolDir, basename(src))
  if (existsSync(dest)) {
    // Idempotency check: if a .deb with the same filename is already in the
    // pool from a previous run, it MUST have identical bytes. Silently
    // overwriting would invalidate any client cache that already trusted
    // the old hash, and re-signing wouldn't fix in-flight upgrades.
    const a = readFileSync(src)
    const b = readFileSync(dest)
    if (!a.equals(b)) {
      console.error(`refusing to overwrite ${dest}: contents differ from ${src}`)
      console.error('Bump the version (or delete the existing file) and retry.')
      process.exit(1)
    }
    console.log(`  pool = ${basename(src)} (already present, identical)`)
    continue
  }
  copyFileSync(src, dest)
  console.log(`  pool + ${basename(src)}`)
}

// ── Discover architectures from the merged pool ───────────────────────────
// Filename convention: <name>_<version>_<arch>.deb
function archOf(filename) {
  const m = filename.match(/_([^_]+)\.deb$/)
  return m ? m[1] : null
}

const allDebs = readdirSync(poolDir).filter(f => f.endsWith('.deb'))
const architectures = [...new Set(allDebs.map(archOf).filter(Boolean))].sort()
if (architectures.length === 0) {
  console.error('no parseable architectures in pool/')
  process.exit(1)
}
console.log(`  archs : ${architectures.join(', ')}`)

// ── Generate Packages / Packages.gz per architecture ──────────────────────
for (const arch of architectures) {
  const distDir = join(outDir, 'dists', suite, component, `binary-${arch}`)
  mkdirSync(distDir, { recursive: true })

  // dpkg-scanpackages emits paths relative to its cwd, so we run it from
  // outDir to get pool/... paths (which is what apt clients fetch by).
  const packages = exec(
    'dpkg-scanpackages',
    ['--arch', arch, `pool/${component}`, '/dev/null'],
    { capture: true, cwd: outDir },
  )

  if (!packages.trim()) {
    console.error(`dpkg-scanpackages produced an empty index for arch=${arch}`)
    process.exit(1)
  }

  const packagesPath = join(distDir, 'Packages')
  writeFileSync(packagesPath, packages)
  exec('gzip', ['-fk9', packagesPath])
  console.log(`  index : dists/${suite}/${component}/binary-${arch}/Packages{,.gz}`)
}

// ── Generate Release ──────────────────────────────────────────────────────
const aptConfPath = join(outDir, 'apt-release.conf')
writeFileSync(aptConfPath, [
  `APT::FTPArchive::Release::Origin "${origin}";`,
  `APT::FTPArchive::Release::Label "${label}";`,
  // Suite is the apt-facing channel name; Codename is the same value here
  // because we only ship one channel. If we add e.g. "beta" later, those
  // become two distinct dists/<name> trees.
  `APT::FTPArchive::Release::Suite "${suite}";`,
  `APT::FTPArchive::Release::Codename "${suite}";`,
  `APT::FTPArchive::Release::Architectures "${architectures.join(' ')}";`,
  `APT::FTPArchive::Release::Components "${component}";`,
  `APT::FTPArchive::Release::Description "ClaudeWatch APT repository";`,
  '',
].join('\n'))

const releaseFile = join(outDir, 'dists', suite, 'Release')
const release = exec(
  'apt-ftparchive',
  ['-c', aptConfPath, 'release', `dists/${suite}`],
  { capture: true, cwd: outDir },
)
writeFileSync(releaseFile, release)
console.log(`  meta  : dists/${suite}/Release`)

// ── Sign Release ──────────────────────────────────────────────────────────
// Two artefacts apt clients accept: detached (Release.gpg) and inline-signed
// (InRelease). Modern apt prefers InRelease; we ship both for compatibility.
//
// The passphrase, if set, is fed via stdin so it never appears in argv. We
// use --pinentry-mode loopback + --passphrase-fd 0 so gpg-agent doesn't try
// to prompt on a non-existent tty inside CI.
const passphrase = process.env['APT_GPG_PASSPHRASE'] ?? ''
const baseGpgArgs = [
  '--batch',
  '--yes',
  '--pinentry-mode', 'loopback',
  '--passphrase-fd', '0',
  '--default-key', gpgKeyId,
]

execWithStdin(
  'gpg',
  [...baseGpgArgs, '-abs', '-o', `${releaseFile}.gpg`, releaseFile],
  passphrase,
)
execWithStdin(
  'gpg',
  [...baseGpgArgs, '--clearsign', '-o', join(outDir, 'dists', suite, 'InRelease'), releaseFile],
  passphrase,
)
console.log(`  sign  : Release.gpg, InRelease`)

// ── Export public key for clients ─────────────────────────────────────────
const pubkey = exec('gpg', ['--armor', '--export', gpgKeyId], { capture: true })
if (!pubkey.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
  console.error('gpg --export produced no key material; is the key id correct?')
  process.exit(1)
}
writeFileSync(join(outDir, 'pubkey.gpg'), pubkey)
console.log(`  pubkey: pubkey.gpg`)

// ── Landing page so visiting the bare URL is not a 404 ────────────────────
const indexHtml = `<!doctype html>
<meta charset="utf-8">
<title>ClaudeWatch APT repository</title>
<h1>ClaudeWatch APT repository</h1>
<p>Add this repo and install:</p>
<pre>sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://maydali28.github.io/claudewatch/pubkey.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/claudewatch.gpg
echo "deb [signed-by=/etc/apt/keyrings/claudewatch.gpg] https://maydali28.github.io/claudewatch ${suite} ${component}" | sudo tee /etc/apt/sources.list.d/claudewatch.list
sudo apt update
sudo apt install claudewatch</pre>
<p>Source: <a href="https://github.com/maydali28/claudewatch">github.com/maydali28/claudewatch</a></p>
`
writeFileSync(join(outDir, 'index.html'), indexHtml)

// Tell GitHub Pages not to run Jekyll over the tree — Jekyll would skip
// files starting with `_` (none today, but `_apt` etc. could appear in
// future), and we don't want surprises.
writeFileSync(join(outDir, '.nojekyll'), '')

console.log(`\nAPT repo built at ${outDir} (${allDebs.length} package(s), ${architectures.length} arch)`)
