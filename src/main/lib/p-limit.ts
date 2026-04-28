/**
 * Minimal concurrency limiter — caps the number of in-flight async operations
 * to `concurrency`. Avoids pulling in `p-limit` as a dependency for a 30-line
 * utility. Used by the project scanner so a user with hundreds of session
 * files doesn't open hundreds of file handles in parallel and starve the
 * event loop.
 */
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (concurrency < 1) throw new Error('concurrency must be >= 1')
  let active = 0
  const queue: Array<() => void> = []

  const next = (): void => {
    if (active >= concurrency) return
    const job = queue.shift()
    if (job) {
      active++
      job()
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
  }
}
