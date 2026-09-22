/**
 * Lines in a markdown body, as the "Body (N lines)" heading reports it.
 *
 * A trailing newline ends the last line rather than starting a new one, and
 * an empty body has no lines. `content.split('\n').length` got both wrong,
 * and three panels each computed it their own way.
 */
export function lineCount(content: string): number {
  if (content === '') return 0
  return content.replace(/\n$/, '').split('\n').length
}
