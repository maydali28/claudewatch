import { describe, expect, it } from 'vitest'
import { AppLinks, DEFAULT_REPO_URL, linkOrDefault } from './app-links'

describe('linkOrDefault', () => {
  it('falls back when the build variable is missing or blank', () => {
    expect(linkOrDefault(undefined, DEFAULT_REPO_URL)).toBe(DEFAULT_REPO_URL)
    expect(linkOrDefault('  ', DEFAULT_REPO_URL)).toBe(DEFAULT_REPO_URL)
  })

  it('keeps a configured link, without a trailing slash', () => {
    expect(linkOrDefault('https://example.org/repo/', DEFAULT_REPO_URL)).toBe(
      'https://example.org/repo'
    )
  })
})

describe('AppLinks', () => {
  it('always holds strings, so the About page can format them', () => {
    expect(typeof AppLinks.website).toBe('string')
    expect(AppLinks.releases).toBe(`${AppLinks.repo}/releases`)
  })
})
