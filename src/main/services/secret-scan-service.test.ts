import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { SecretFindingRecord } from '@shared/types/secrets'
import { createSecretFindingsStore, MAX_FINDINGS } from './secret-findings-store'
import { SecretScanService } from './secret-scan-service'

// Built at runtime so no secret-shaped literal sits in the repository.
const OLD = 'ghp_' + 'Old3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c'
const NEW = 'ghp_' + 'New3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c'
const SUB = 'sk-ant-' + 'api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2'

const line = (text: string, ts = '2026-10-04T10:00:00.000Z'): string =>
  JSON.stringify({ type: 'user', timestamp: ts, message: { content: text } }) + '\n'

let root: string
let projects: string
let session: string
let enabled: boolean
let notified: SecretFindingRecord[]

function service(store = createSecretFindingsStore(path.join(root, 'data'))): SecretScanService {
  return new SecretScanService({
    projectsDir: projects,
    store,
    isEnabled: () => enabled,
    onNewFindings: (f) => notified.push(...f),
    now: () => new Date('2026-10-04T12:00:00.000Z'),
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-'))
  projects = path.join(root, 'projects')
  fs.mkdirSync(path.join(projects, 'proj'), { recursive: true })
  session = path.join(projects, 'proj', 'sess.jsonl')
  fs.writeFileSync(session, line(`old ${OLD}`))
  enabled = true
  notified = []
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('SecretScanService, live', () => {
  it('reports only what is written after scanning starts', async () => {
    const s = service()
    await s.sync()
    fs.appendFileSync(session, line(`new ${NEW}`, '2026-10-04T11:00:00.000Z'))
    const found = await s.scanChanged([session])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      checkId: 'SEC007',
      projectId: 'proj',
      sessionId: 'sess',
      occurredAt: '2026-10-04T11:00:00.000Z',
      source: 'live',
    })
    expect(found[0].maskedValue).not.toBe(NEW)
    expect(found[0].lineNumber).toBeUndefined()
    expect(notified).toHaveLength(1)
    // Read once: nothing new the second time.
    expect(await s.scanChanged([session])).toEqual([])
  })

  it('counts one key matched by two patterns once, named by the specific one', async () => {
    const s = service()
    await s.sync()
    fs.appendFileSync(session, line(`api_key = ${SUB}`))
    const found = await s.scanChanged([session])
    expect(found).toHaveLength(1)
    expect(found[0].patternName).toBe('Platform Token')
  })

  it('reads a sub-agent transcript created afterwards from its first line', async () => {
    const s = service()
    await s.sync()
    const subDir = path.join(projects, 'proj', 'sess', 'subagents')
    fs.mkdirSync(subDir, { recursive: true })
    const sub = path.join(subDir, 'agent-a1.jsonl')
    fs.writeFileSync(sub, line(`key ${SUB}`))
    const found = await s.scanChanged([sub])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ sessionId: 'sess', agentId: 'a1', checkId: 'SEC007' })
  })

  it('does nothing without consent', async () => {
    enabled = false
    const s = service()
    await s.sync()
    fs.appendFileSync(session, line(`new ${NEW}`))
    expect(await s.scanChanged([session])).toEqual([])
    expect(s.active).toBe(false)
  })
})

describe('SecretScanService, history', () => {
  it('finds what is already on disk, once, with its line number', async () => {
    enabled = false // history scanning does not depend on the live switch
    const s = service()
    const first = await s.scanHistory()
    expect(first).toMatchObject({ filesScanned: 1, newFindings: 1 })
    expect(notified[0]).toMatchObject({ lineNumber: 1, source: 'history' })
    expect((await s.scanHistory()).newFindings).toBe(0)
  })

  it('never writes the secret itself to disk', async () => {
    const dataDir = path.join(root, 'data')
    await service(createSecretFindingsStore(dataDir)).scanHistory()
    const onDisk = fs.readFileSync(path.join(dataDir, 'secret-findings.json'), 'utf-8')
    expect(onDisk).not.toContain(OLD)
    expect(onDisk).toContain('ghp_')
  })
})

describe('createSecretFindingsStore', () => {
  const finding = (id: string, foundAt: string, dismissed = false): SecretFindingRecord => ({
    id,
    fingerprint: id,
    checkId: 'SEC007',
    severity: 'warning',
    patternName: 'Platform Token',
    maskedValue: 'ghp_****',
    projectId: 'p',
    sessionId: 's',
    foundAt,
    source: 'live',
    dismissed,
  })

  it('persists, dismisses and reloads', () => {
    const dir = path.join(root, 'store')
    const store = createSecretFindingsStore(dir)
    expect(store.add([finding('a', '1'), finding('a', '1'), finding('b', '2')])).toHaveLength(2)
    store.dismiss(['a'])
    const reloaded = createSecretFindingsStore(dir).list()
    expect(reloaded.map((f) => [f.id, f.dismissed])).toEqual([
      ['a', true],
      ['b', false],
    ])
  })

  it('drops dismissed findings first when full', () => {
    const store = createSecretFindingsStore(path.join(root, 'cap'))
    const many = Array.from({ length: MAX_FINDINGS }, (_, i) =>
      finding(`f${i}`, String(i).padStart(5, '0'), i === 500)
    )
    store.add(many)
    store.add([finding('extra', '99999')])
    const ids = new Set(store.list().map((f) => f.id))
    expect(ids.size).toBe(MAX_FINDINGS)
    expect(ids.has('f500')).toBe(false)
    expect(ids.has('f0')).toBe(true)
  })
})
