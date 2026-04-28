/**
 * Shannon entropy of a string — used to filter out low-entropy false positives
 * in secret detection (e.g. "aaaaaaaa" has near-zero entropy, a real secret has high).
 *
 * Returns bits of entropy per character.
 */
export function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0

  const freq: Record<string, number> = {}
  for (const ch of str) {
    freq[ch] = (freq[ch] ?? 0) + 1
  }

  let entropy = 0
  const len = str.length
  for (const count of Object.values(freq)) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/** Count the number of unique characters in a string. */
export function uniqueCharCount(str: string): number {
  return new Set(str).size
}
