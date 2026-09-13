import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { findGlobMatches } from './rul.rules'

let root: string

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rul-glob-'))
  fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), '')
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), '')
  fs.writeFileSync(path.join(root, 'src', 'nested', 'c.ts'), '')
  fs.writeFileSync(path.join(root, 'readme.md'), '')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/**
 * `fs.glob` is callback-based: calling it without a callback and then treating
 * the result as a promise threw, and the surrounding catch swallowed it. Every
 * pattern therefore appeared to match nothing — and because RUL003 only fires
 * when a pattern matches nothing, the rule silently reported nothing at all.
 */
describe('findGlobMatches', () => {
  it('finds files matching a pattern in one directory', async () => {
    const found = await findGlobMatches('src/*.ts', root)
    expect(found.sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('finds files matching a recursive pattern', async () => {
    const found = await findGlobMatches('src/**/*.ts', root)
    expect(found.length).toBe(3)
  })

  it('returns an empty array when a pattern matches nothing', async () => {
    expect(await findGlobMatches('src/*.rs', root)).toEqual([])
  })

  it('returns an empty array for a non-existent directory', async () => {
    expect(await findGlobMatches('nope/*.ts', root)).toEqual([])
  })
})
