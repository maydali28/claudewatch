/**
 * Debounces file-change events into re-parses, one file at a time, and never
 * loses a change that arrives while that file's parse is running.
 *
 * The watcher previously returned early when a parse was in flight, which threw
 * the event away. A session streaming a long turn writes continuously, so the
 * writes landing during a parse were simply lost and the session stayed stale
 * until something else happened to touch it.
 */
export class ReparseScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inFlight = new Set<string>()
  /** Files changed while their own parse was running. */
  private dirty = new Set<string>()
  private stopped = false

  constructor(
    private readonly run: (filePath: string) => Promise<void>,
    private readonly debounceMs: number
  ) {}

  schedule(filePath: string): void {
    if (this.stopped) return

    // A parse is running for this file: remember that it moved and catch up
    // once, when that parse finishes. Repeated writes collapse into one retry.
    if (this.inFlight.has(filePath)) {
      this.dirty.add(filePath)
      return
    }

    const existing = this.timers.get(filePath)
    if (existing) clearTimeout(existing)

    this.timers.set(
      filePath,
      setTimeout(() => {
        this.timers.delete(filePath)
        void this.execute(filePath)
      }, this.debounceMs)
    )
  }

  private async execute(filePath: string): Promise<void> {
    this.inFlight.add(filePath)
    try {
      await this.run(filePath)
    } finally {
      this.inFlight.delete(filePath)
      // Catch up on anything that arrived mid-parse. A failed parse still
      // retries: the file changed, and the previous result is stale either way.
      if (this.dirty.delete(filePath) && !this.stopped) {
        this.schedule(filePath)
      }
    }
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.dirty.clear()
  }
}
