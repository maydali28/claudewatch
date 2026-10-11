import { describe, expect, it, vi } from 'vitest'
import type { SecretFindingRecord } from '@shared/types/secrets'
import { notifySecretFindings, type SecretNotifierDeps } from './secret-notifier'

const f = (over: Partial<SecretFindingRecord>): SecretFindingRecord => ({
  id: Math.random().toString(),
  fingerprint: 'x',
  checkId: 'SEC007',
  severity: 'warning',
  patternName: 'Platform Token',
  maskedValue: 'ghp_****Ab7c',
  projectId: 'p',
  sessionId: 's',
  foundAt: '',
  source: 'live',
  dismissed: false,
  ...over,
})

function deps(over: Partial<SecretNotifierDeps> = {}): SecretNotifierDeps & { shown: unknown[] } {
  const shown: unknown[] = []
  return {
    shown,
    isEnabled: () => true,
    isAppFocused: () => false,
    titleOf: () => 'Fix the deploy',
    show: (n) => shown.push(n),
    openSession: vi.fn(),
    ...over,
  }
}

describe('notifySecretFindings', () => {
  it('shows one notification per session, without the value', () => {
    const d = deps()
    notifySecretFindings([f({}), f({ patternName: 'AWS Access Key' }), f({ sessionId: 't' })], d)
    expect(d.shown).toHaveLength(2)
    const first = d.shown[0] as { body: string; onClick: () => void }
    expect(first.body).toBe('2 possible secrets were written to “Fix the deploy”.')
    expect((d.shown[1] as { body: string }).body).toBe(
      'A possible Platform Token was written to “Fix the deploy”.'
    )
    expect(JSON.stringify(d.shown)).not.toContain('****')
    first.onClick()
    expect(d.openSession).toHaveBeenCalledWith('p', 's')
  })

  it('stays quiet when focused, turned off, or for history findings', () => {
    for (const d of [deps({ isAppFocused: () => true }), deps({ isEnabled: () => false })]) {
      notifySecretFindings([f({})], d)
      expect(d.shown).toEqual([])
    }
    const d = deps()
    notifySecretFindings([f({ source: 'history' })], d)
    expect(d.shown).toEqual([])
  })
})
