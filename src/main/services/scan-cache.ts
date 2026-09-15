import type { SessionSummary } from '@shared/types/session'
import type { ScanProjectsResult } from './accounting/worker-protocol'
import { Preferences } from '@main/store/preferences'
import { getActivePricingTable, pricingFingerprint } from './pricing-engine'
import { accountingWorker } from './accounting/worker-client'
import { compareTimestampsAscending } from '@shared/utils/date-ranges'

type ScanResult = ScanProjectsResult

/**
 * In-memory cache of the last full project scan.
 *
 * Owned by the main process and read by every sessions:* IPC handler. The
 * file watcher patches this cache incrementally via `patchSessionSummary` so
 * the renderer can list sessions without paying for a fresh disk scan on
 * every request.
 */
export class ScanCache {
  private current: ScanResult | null = null
  private inFlight: Promise<ScanResult> | null = null
  // Which table the in-flight scan (if any) was started with. Lets `refresh`
  // tell "a scan is already running for what I'd ask for anyway" apart from
  // "a scan is running under rates that no longer apply" — see below.
  private inFlightFingerprint: string | null = null

  /**
   * Monotonic identity for scans, in start order. Two scans can share a
   * `fingerprint` (same rates, e.g. the tray and dashboard cold-opening
   * together) or differ (a settings write that changed a rate mid-scan) —
   * either way, start order is what "newer" means here, and the fingerprint
   * can't express it. `publishedGeneration` records which generation is
   * currently reflected in `current`, so a scan only overwrites it when it
   * is strictly newer than what's already published, regardless of which
   * order the scans happen to resolve in.
   *
   * The gate is "newer than published" (`<=`), not "is the single
   * newest-started scan" (`===`), specifically so `get()` stays null-safe:
   * on a cold start, `publishedGeneration` is 0, so whichever scan resolves
   * *first* always clears the gate and publishes, even if a newer one is
   * still in flight. Under the stricter `===` form, a non-latest scan that
   * resolves first would publish nothing, and if it were the only one
   * `get()` was waiting on, `current` would still be null when `get()`
   * returns — see the cast in `get()` below, and
   * `scan-cache.test.ts`'s "get() never resolves null" test, which fails
   * under the stricter gate and pins this.
   */
  private generation = 0
  private publishedGeneration = 0

  /**
   * Summaries that arrived while a scan was in flight, newest per session
   * (a later patch for the same session simply replaces the earlier one in
   * the map). `refresh()` replaces `current` wholesale, and a patch applied
   * to the outgoing object in place was silently discarded when the scan
   * resolved — a watcher update would appear and then revert. Buffering and
   * replaying onto the fresh result instead makes the published snapshot
   * revision-consistent rather than last-writer-wins. Also covers the case
   * where no scan has ever completed: `current` is null, so there is
   * nothing to patch in place yet, but the patch must not be dropped.
   */
  private pendingPatches = new Map<string, SessionSummary>()

  /**
   * The removal-side counterpart of `pendingPatches`, for exactly the same
   * reason: `refresh()`'s `.then()` replaces `current` wholesale with a
   * fresh scan result, so a removal applied only to the outgoing `current`
   * (as `removeSession` used to do, in isolation) is silently undone the
   * moment an in-flight scan lands — the very session just deleted comes
   * back because the scan started before the deletion and still lists it.
   * Maps session id -> the project it was removed from, so the replay in
   * `refresh()` can find it in the fresh result without re-deriving it.
   *
   * `pendingPatches` and `pendingRemovals` are kept mutually exclusive per
   * session id: whichever call (patch or remove) happens most recently for
   * a given id evicts that id from the other buffer first, so the more
   * recent event always wins the eventual replay — see the delete calls in
   * `patchSessionSummary` and `removeSession` below.
   */
  private pendingRemovals = new Map<string, string>()

  /**
   * Returns the cached scan, performing a fresh scan if the cache is empty.
   */
  async get(): Promise<ScanResult> {
    if (!this.current) {
      await this.refresh()
    }
    // The first scan to ever resolve always publishes (`publishedGeneration`
    // starts at 0), so `current` is guaranteed set once `refresh()` settles.
    return this.current as ScanResult
  }

  /**
   * Force a fresh scan and replace the cache.
   */
  async refresh(): Promise<ScanResult> {
    const prefs = Preferences.get()
    const pricingTable = getActivePricingTable(prefs)
    const fingerprint = pricingFingerprint(pricingTable)

    // Share one in-flight scan — but only when it was started under the same
    // rates. Without the dedup at all, concurrent cold requests (the tray and
    // the dashboard opening together) would each start a full scan and the
    // slower one would overwrite the newer result when it finished. But
    // joining an in-flight scan unconditionally has its own bug: a settings
    // write that just changed a rate would hand back a scan already running
    // under the OLD table, report success, and never actually bust anything
    // — the correction would surface only whenever some unrelated later
    // refresh happened to run. Comparing fingerprints keeps the dedup for
    // same-table callers while forcing a pricing-driven refresh to start its
    // own scan.
    if (this.inFlight && this.inFlightFingerprint === fingerprint) return this.inFlight

    const generation = ++this.generation

    const request = accountingWorker
      .scanProjects(pricingTable)
      .then((result) => {
        // A scan strictly older than what's already published must not
        // clobber it — this is the "differently-priced scans can now both
        // be in flight" race: an old-rates scan started first can resolve
        // after a new-rates one and must lose, however the promises settle.
        // See the class-level comment on `generation` for why this compares
        // against `publishedGeneration` rather than requiring this to be
        // the single newest-started scan.
        if (generation <= this.publishedGeneration) return this.current as ScanResult

        // Replay patches that arrived while any scan was in flight onto
        // this fresh result rather than the object it is replacing.
        // `applyPatch` returns false when this fresh result still doesn't
        // contain the patch's project (e.g. a brand-new project directory
        // this scan started before it existed on disk) — track those
        // separately instead of discarding the boolean, so they aren't lost
        // below alongside the patches that did apply. This mirrors how the
        // direct path in `patchSessionSummary` already re-buffers on a false
        // return rather than dropping it.
        const unresolvedPatches = new Map<string, SessionSummary>()
        for (const [sessionId, patch] of this.pendingPatches) {
          if (!this.applyPatch(result, patch)) {
            unresolvedPatches.set(sessionId, patch)
          }
        }
        // Removals replay AFTER patches: `pendingPatches` and
        // `pendingRemovals` are kept mutually exclusive per session id (see
        // the buffer doc comment), so this ordering only matters in that it
        // must be consistent — it is not resolving a real conflict between
        // the two maps, since the same id can never be in both at once.
        for (const [sessionId, projectId] of this.pendingRemovals) {
          this.applyRemoval(result, projectId, sessionId)
        }
        this.current = result
        this.publishedGeneration = generation

        // Only settle the buffers once nothing newer is still running to
        // consume them. If an older scan is the first to publish (nothing
        // has published yet, so it's "newer than published" even though
        // it isn't the newest *started*), a still-in-flight newer scan
        // will replace `current` wholesale when it resolves — touching the
        // buffers now would lose any patch/removal only this replay applied,
        // or a still-unresolved patch that a later, still-in-flight scan
        // (started under fresher disk state) might actually be able to
        // place.
        //
        // `pendingPatches` is replaced with `unresolvedPatches` rather than
        // cleared outright: a patch this replay could apply is done and
        // drops out, but one whose project this fresh result still doesn't
        // know about must survive for the NEXT refresh to retry — otherwise
        // it is silently dropped and nothing ever re-applies it.
        // `pendingRemovals` has no equivalent retry case: `applyRemoval` is
        // a no-op, not a failure, when the fresh result already reflects the
        // deletion on its own (see its doc comment), so clearing it outright
        // remains correct.
        if (generation === this.generation) {
          this.pendingPatches = unresolvedPatches
          this.pendingRemovals.clear()
        }

        return this.current
      })
      .finally(() => {
        // Only clear the in-flight slot if we still own it — an older,
        // stale-priced scan finishing after a newer one replaced it must not
        // wipe the newer scan's tracking out from under it.
        if (this.inFlight === request) {
          this.inFlight = null
          this.inFlightFingerprint = null
        }
      })
    this.inFlight = request
    this.inFlightFingerprint = fingerprint

    return request
  }

  /**
   * Apply an updated session summary to the cache. If a scan is in flight
   * (or none has ever completed) the patch is buffered and replayed by
   * `refresh()` instead of being applied to data that's about to be
   * replaced — or, before the first scan, to nothing at all.
   */
  async patchSessionSummary(summary: SessionSummary): Promise<void> {
    // A patch is a newer event than any earlier buffered removal for this
    // id — e.g. the session was deleted and then recreated with the same
    // id — so it must win the eventual replay instead of the removal.
    this.pendingRemovals.delete(summary.id)

    if (this.inFlight || !this.current) {
      this.pendingPatches.set(summary.id, summary)
      if (!this.current && !this.inFlight) await this.refresh()
      return
    }

    if (!this.applyPatch(this.current, summary)) {
      // Unknown project (e.g. a brand-new project directory): the cache is
      // stale, not just this one session. Buffer the patch too, so the
      // fresh scan's replay picks it up instead of relying on the scan
      // alone to have equivalently fresh data for it.
      this.pendingPatches.set(summary.id, summary)
      await this.refresh()
    }
  }

  /**
   * Mutates `result` in place: inserts or replaces `summary` in its
   * project's session list, keeping sort order and `sessionCount`
   * consistent. Returns false when the summary's project isn't in `result`,
   * leaving the caller to decide whether that's worth a refresh.
   */
  private applyPatch(result: ScanResult, summary: SessionSummary): boolean {
    const project = result.projects.find((p) => p.id === summary.projectId)
    if (!project) return false

    const sessionIndex = project.sessions.findIndex((s) => s.id === summary.id)
    if (sessionIndex === -1) {
      project.sessions.push(summary)
      // `unshift` only left the list correctly ordered when the new session
      // happened to be the newest one; sort explicitly so it lands wherever
      // its `lastTimestamp` actually belongs. Uses `compareTimestampsAscending`
      // (descending here, so the arguments are swapped rather than negating
      // the result) instead of subtracting two `getTime()`s directly: two
      // unparsable timestamps both mapping to `-Infinity` subtract to `NaN`,
      // and a comparator that can return `NaN` breaks `Array.prototype.sort`'s
      // contract — the same bug already fixed at every other timestamp-sort
      // call site in the app.
      project.sessions.sort((a, b) => compareTimestampsAscending(b.lastTimestamp, a.lastTimestamp))
    } else {
      project.sessions[sessionIndex] = summary
    }
    project.sessionCount = project.sessions.length

    return true
  }

  /**
   * Mutates `result` in place: drops `sessionId` from `projectId`'s session
   * list if present, keeping `sessionCount` consistent — the removal-side
   * counterpart of `applyPatch`, used both by `removeSession`'s direct
   * mutation and by `refresh()`'s replay of `pendingRemovals` onto a fresh
   * scan result. A no-op if the project or session isn't there (e.g. the
   * fresh scan already reflects the deletion on its own).
   */
  private applyRemoval(result: ScanResult, projectId: string, sessionId: string): void {
    const project = result.projects.find((p) => p.id === projectId)
    if (!project) return
    const index = project.sessions.findIndex((s) => s.id === sessionId)
    if (index === -1) return
    project.sessions.splice(index, 1)
    project.sessionCount = project.sessions.length
  }

  /**
   * Returns the sessions for a project from the cache, or an empty array
   * if the project is unknown.
   */
  async getSessionsForProject(projectId: string): Promise<SessionSummary[]> {
    const scan = await this.get()
    return scan.projects.find((p) => p.id === projectId)?.sessions ?? []
  }

  /**
   * Drop a session whose transcript was deleted. Synchronous, and mutates
   * `current` in place like `applyPatch` does — but that mutation alone is
   * not enough: it only touches the OUTGOING `current`, and a scan already
   * in flight when this runs still resolves with the pre-deletion result,
   * which `refresh()` then swaps in wholesale (line ~114), silently
   * resurrecting the session this call just removed. Buffering into
   * `pendingRemovals` is what makes `refresh()` re-apply the removal to
   * that fresh result too, exactly as `pendingPatches` already does for
   * updates — see that field's doc comment for the ordering guarantees.
   */
  removeSession(projectId: string, sessionId: string): void {
    // A create/update for this id may still be sitting in the buffer from
    // just before the delete arrived — drop it too, or a still-in-flight
    // scan's replay would apply the stale patch after this removal and
    // resurrect the very session this call just removed.
    this.pendingPatches.delete(sessionId)
    this.pendingRemovals.set(sessionId, projectId)

    if (this.current) this.applyRemoval(this.current, projectId, sessionId)
  }

  /**
   * Synchronous peek at a project's currently cached sessions — unlike
   * `getSessionsForProject`, never triggers a scan. Used when a whole
   * project directory disappeared: a fresh scan would just re-read the
   * (now missing) directory and find nothing left to enumerate.
   */
  peekProjectSessions(projectId: string): SessionSummary[] {
    return this.current?.projects.find((p) => p.id === projectId)?.sessions ?? []
  }
}

export const scanCache = new ScanCache()
