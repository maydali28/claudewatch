import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const stored: Record<string, unknown> = {}
vi.mock('@main/store/preferences', () => ({
  Preferences: {
    set: (patch: Record<string, unknown>) => Object.assign(stored, patch),
  },
}))

import { changeClaudeDir, inspectClaudeDir, onClaudeDirChange } from './claude-dir-service'
import {
  getClaudeDir,
  getClaudeDirSource,
  resetClaudeDirCache,
  resolveClaudeDirWithoutAppSetting,
  setClaudeDirOverride,
} from '@main/lib/claude-paths'

let root: string
const savedEnv = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-dir-'))
  resetClaudeDirCache()
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  if (savedEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedEnv
  resetClaudeDirCache()
})

describe('the app setting', () => {
  it('wins over CLAUDE_CONFIG_DIR, and clearing it falls back', () => {
    process.env.CLAUDE_CONFIG_DIR = path.join(root, 'from-env')
    setClaudeDirOverride(path.join(root, 'chosen'))
    expect(getClaudeDir()).toBe(path.join(root, 'chosen'))
    expect(getClaudeDirSource()).toBe('app-setting')
    expect(resolveClaudeDirWithoutAppSetting()).toEqual({
      dir: path.join(root, 'from-env'),
      source: 'env',
    })
    setClaudeDirOverride(null)
    expect(getClaudeDirSource()).toBe('env')
  })
})

describe('inspectClaudeDir', () => {
  it('tells a missing path, a file, an empty folder and a Claude folder apart', async () => {
    expect(await inspectClaudeDir(path.join(root, 'nope'))).toMatchObject({ exists: false })
    fs.writeFileSync(path.join(root, 'file'), '')
    expect(await inspectClaudeDir(path.join(root, 'file'))).toMatchObject({
      exists: true,
      isDirectory: false,
    })
    fs.mkdirSync(path.join(root, 'empty'))
    expect(await inspectClaudeDir(path.join(root, 'empty'))).toMatchObject({
      isDirectory: true,
      looksLikeClaudeDir: false,
    })
    const claude = path.join(root, 'claude')
    fs.mkdirSync(path.join(claude, 'projects', '-a'), { recursive: true })
    fs.mkdirSync(path.join(claude, 'projects', '-b'), { recursive: true })
    fs.writeFileSync(path.join(claude, 'projects', '-a', 's1.jsonl'), '')
    fs.writeFileSync(path.join(claude, 'projects', '-a', 's2.jsonl'), '')
    fs.writeFileSync(path.join(claude, 'settings.json'), '{}')
    expect(await inspectClaudeDir(`${claude}  `)).toEqual({
      path: claude,
      exists: true,
      isDirectory: true,
      projectCount: 2,
      sessionCount: 2,
      hasSettings: true,
      looksLikeClaudeDir: true,
    })
  })
})

describe('changeClaudeDir', () => {
  it('refuses a folder that does not exist, and changes nothing', async () => {
    const handler = vi.fn(async () => {})
    onClaudeDirChange(handler)
    await expect(changeClaudeDir(path.join(root, 'nope'))).rejects.toThrow('does not exist')
    expect(handler).not.toHaveBeenCalled()
  })

  it('stores, applies and announces a folder, and goes back with null', async () => {
    const handler = vi.fn(async () => {})
    onClaudeDirChange(handler)
    await changeClaudeDir(root)
    expect(stored.claudeDirOverride).toBe(root)
    expect(handler).toHaveBeenCalledWith(root)
    expect(getClaudeDirSource()).toBe('app-setting')
    await changeClaudeDir(null)
    expect(stored.claudeDirOverride).toBeUndefined()
    expect(getClaudeDirSource()).not.toBe('app-setting')
  })
})
