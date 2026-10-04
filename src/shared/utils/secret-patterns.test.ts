import { describe, expect, it } from 'vitest'
import { findSecretValues, maskSecret, redactText, REDACTED_PLACEHOLDER } from './secret-patterns'

// Built at runtime so this file never contains a literal that a secret
// scanner (this one, or the repository's) would flag.
const GH = 'ghp_' + 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c'
const ANT = 'sk-ant-' + 'api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2'

describe('findSecretValues', () => {
  it('finds every occurrence, beyond the scanner cap', () => {
    const text = [GH, GH, ANT, `token ${GH}`].join('\n')
    expect(findSecretValues(text).sort()).toEqual([ANT, GH].sort())
  })

  it('skips placeholders and conversational mentions', () => {
    expect(findSecretValues('api_key = "your-api-key-goes-here-123"')).toEqual([])
    expect(findSecretValues('set your api_key=Abc123Def456Ghi789Jkl in the .env file')).toEqual([])
  })
})

describe('redactText', () => {
  const text = `use ${GH} and ${ANT}`

  it('masks every secret, keeping first and last four characters', () => {
    const out = redactText(text, 'mask')
    expect(out).toBe(`use ${maskSecret(GH)} and ${maskSecret(ANT)}`)
    expect(out).not.toContain(GH)
  })

  it('removes them entirely', () => {
    expect(redactText(text, 'remove')).toBe(
      `use ${REDACTED_PLACEHOLDER} and ${REDACTED_PLACEHOLDER}`
    )
  })

  it('leaves text alone at none', () => {
    expect(redactText(text, 'none')).toBe(text)
  })

  it('hides a whole private key, not just its header', () => {
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC'
    const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
    expect(redactText(`key:\n${pem}\ndone`, 'mask')).not.toContain(body)
    expect(redactText(`key:\n${pem}\ndone`, 'remove')).toBe(`key:\n${REDACTED_PLACEHOLDER}\ndone`)
  })
})
