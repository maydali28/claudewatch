import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { samePath } from './same-path'

// A home folder reached through a symlink (e.g. /home -> /System/Volumes/Data/home,
// or a relocated home) names the same files under two spellings. Comparing the
// text of the paths listed those files twice.

let tmp: string
let real: string
let link: string
let canSymlink = true

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'same-path-'))
  real = path.join(tmp, 'real-home')
  link = path.join(tmp, 'linked-home')
  fs.mkdirSync(path.join(real, '.claude'), { recursive: true })
  try {
    fs.symlinkSync(real, link, 'dir')
  } catch {
    // Windows without the symlink privilege.
    canSymlink = false
  }
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('samePath', () => {
  it('treats spellings that resolve to the same text as the same', () => {
    expect(samePath(path.join(real, 'a', '..', '.claude'), path.join(real, '.claude'))).toBe(true)
  })

  it('tells different locations apart', () => {
    expect(samePath(path.join(real, '.claude'), path.join(tmp, 'elsewhere', '.claude'))).toBe(false)
  })

  it('treats a folder reached through a symlink as the folder itself', (ctx) => {
    if (!canSymlink && process.platform === 'win32') ctx.skip()
    expect(samePath(path.join(link, '.claude'), path.join(real, '.claude'))).toBe(true)
  })

  it('follows the symlink even when the file itself does not exist yet', (ctx) => {
    if (!canSymlink && process.platform === 'win32') ctx.skip()
    const file = path.join('.claude', 'settings.json')
    expect(samePath(path.join(link, file), path.join(real, file))).toBe(true)
  })

  it('falls back to the resolved text when nothing on the path exists', () => {
    const missing = path.join(path.parse(tmp).root, 'no-such-root-cw', 'x')
    expect(samePath(missing, path.join(missing, '..', 'x'))).toBe(true)
  })
})
