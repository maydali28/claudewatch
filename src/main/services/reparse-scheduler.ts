/**
 * Debounces file-change events into re-parses, one PARENT SESSION at a time,
 * and never loses a change that arrives while that parent's parse is running.
 *
 * The watcher previously returned early when a parse was in flight, which threw
 * the event away. A session streaming a long turn writes continuously, so the
 * writes landing during a parse were simply lost and the session stayed stale
 * until something else happened to touch it.
 */
export class ReparseScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inFlight = new Set<string>()
  /**
   * Dirty parents, not dirty files.
   *
   * Every change re-parses the parent and all of its children — measured at a
   * median of 6ms but 152ms for the largest session, which has 83 children.
   * Keying by changed file meant a burst across those children queued 83 full
   * parses of the same data. Keying by parent collapses the burst into one job
   * with a trailing re-run.
   */
  private dirty = new Set<string>()
  /**
   * Raw file paths accumulated for a parent since its last run started. The
   * parse itself is coalesced onto the parent — one job covers the parent and
   * every child regardless of which one changed — so nothing reads this set
   * today: the per-file secret scan that used it was removed for 1.5.x.
   *
   * It is kept for that scan's return with a visible alert and a toggle
   * (roadmap #4). A secret scan cannot be coalesced the way the parse is: it
   * reads a delta at a per-file byte offset, so scanning only the parent would
   * silently skip every subagent transcript. Cleared the moment a parent's job
   * starts consuming it (see `execute`), and built back up from nothing for
   * whatever triggers the trailing re-run.
   */
  private contributors = new Map<string, Set<string>>()
  private stopped = false

  constructor(
    private readonly run: (
      parentKey: string,
      contributingFiles: ReadonlySet<string>
    ) => Promise<void>,
    private readonly debounceMs: number = 0,
    /**
     * Where a failed parse is reported. The parse is fired and forgotten, so
     * without this the rejection has nowhere to land — and Node terminates the
     * process on an unhandled rejection, which would let one unreadable
     * transcript take the main process down.
     */
    private readonly onError: (parentKey: string, error: unknown) => void = () => {}
  ) {}

  /**
   * `filePath` is whatever actually changed on disk (a session file, or one of
   * its subagents); `parentKey` is the identity the re-parse runs against and
   * the only thing this scheduler coalesces on. A caller with no parent/child
   * distinction (e.g. settings.json) can omit it — it defaults to `filePath`,
   * which reproduces the old one-file-one-key behaviour exactly.
   */
  schedule(filePath: string, parentKey: string = filePath): void {
    if (this.stopped) return

    const contributors = this.contributors.get(parentKey) ?? new Set<string>()
    contributors.add(filePath)
    this.contributors.set(parentKey, contributors)

    // A parse is running for this parent: remember that one of its files
    // moved and catch up once, when that parse finishes. Repeated writes
    // across any number of that parent's children collapse into one retry.
    if (this.inFlight.has(parentKey)) {
      this.dirty.add(parentKey)
      return
    }

    this.armTimer(parentKey)
  }

  private armTimer(parentKey: string): void {
    const existing = this.timers.get(parentKey)
    if (existing) clearTimeout(existing)

    this.timers.set(
      parentKey,
      setTimeout(() => {
        this.timers.delete(parentKey)
        void this.execute(parentKey)
      }, this.debounceMs)
    )
  }

  private async execute(parentKey: string): Promise<void> {
    this.inFlight.add(parentKey)
    // Snapshot and clear now: anything scheduled from this point on belongs
    // to the *next* run (the trailing catch-up, if one happens), not this one.
    const contributingFiles = this.contributors.get(parentKey) ?? new Set([parentKey])
    this.contributors.delete(parentKey)
    try {
      await this.run(parentKey, contributingFiles)
    } catch (error) {
      this.onError(parentKey, error)
    } finally {
      this.inFlight.delete(parentKey)
      // Catch up on anything that arrived mid-parse. A failed parse still
      // retries: something changed, and the previous result is stale either way.
      // Re-arm the timer directly rather than going through `schedule` — that
      // would also record `parentKey` itself as a contributor, scanning the
      // parent's own delta on every trailing run even when nothing about the
      // parent changed.
      if (this.dirty.delete(parentKey) && !this.stopped) {
        this.armTimer(parentKey)
      }
    }
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.dirty.clear()
    this.contributors.clear()
  }

  /**
   * Resolves once nothing is queued (debounced, or marked dirty for a
   * trailing re-run) or running. A pending debounce timer counts as queued —
   * without it this would return before a just-scheduled burst ever fires.
   * Doubles as a shutdown barrier: awaiting it before quitting means a parse
   * already in flight gets to finish instead of being cut off mid-write.
   */
  async drain(): Promise<void> {
    while (this.timers.size > 0 || this.dirty.size > 0 || this.inFlight.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}
