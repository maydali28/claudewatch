// ─── Tuning Constants ─────────────────────────────────────────────────────────
//
// Centralised numeric thresholds that govern parsing, watching, and
// classification behaviour. Pulled out of individual files so a maintainer
// can audit and tweak runtime behaviour from one place.
//
// All values are validated empirically against real Claude Code session files.
// Changing them affects how sessions are scored — bump the schema version of
// any consumer that persists derived values to disk.

// ─── File watcher (chokidar + debouncer) ──────────────────────────────────────

/** Debounce window for re-parsing a session after a file event. */
export const FILE_WATCHER_DEBOUNCE_MS = 300

/** chokidar awaitWriteFinish stability threshold for settings.json writes. */
export const FILE_WATCHER_WRITE_FINISH_STABILITY_MS = 200

/** chokidar awaitWriteFinish poll interval. */
export const FILE_WATCHER_WRITE_FINISH_POLL_MS = 100

// ─── Session parser: idle / turn duration ─────────────────────────────────────

/**
 * Idle gap (in minutes) above which we flag a "zombie" session — the user
 * walked away while a turn was pending. Empirically, a Claude Code turn
 * almost never legitimately exceeds 75 minutes of wall time.
 */
export const IDLE_GAP_MINUTES = 75
export const IDLE_GAP_MS = IDLE_GAP_MINUTES * 60 * 1000

/**
 * Wall-clock cap for a single turn duration. Anything above this is treated
 * as an idle gap (user left their machine), not real model latency.
 * Ultrathink + long tool chains rarely exceed 5–6 minutes; 10 min is a safe ceiling.
 */
export const MAX_TURN_DURATION_MS = 10 * 60 * 1000

// ─── Session parser: effort classification thresholds ─────────────────────────

/** Output token cap for "low" effort — short answers, no reasoning. */
export const EFFORT_LOW_MAX_TOKENS = 500

/** Output token cap for "medium" effort — typical short tool use. */
export const EFFORT_MEDIUM_MAX_TOKENS = 2000

/** Output token cap for "high" effort — long answers, multi-tool turns. */
export const EFFORT_HIGH_MAX_TOKENS = 5000

/** Thinking-block character cap for "medium" classification. */
export const EFFORT_MEDIUM_THINKING_CHARS = 1000

/** Thinking-block character cap for "high" classification. Above → ultrathink. */
export const EFFORT_HIGH_THINKING_CHARS = 5000

// ─── Session parser: error message snippets ───────────────────────────────────

/** Truncate captured error text to this many characters before storing. */
export const ERROR_SNIPPET_MAX_CHARS = 200

// ─── Secret scanner ───────────────────────────────────────────────────────────

/**
 * Cap on findings per pattern, per file. Prevents a leaked log file with
 * thousands of tokens from flooding the alert pipeline.
 */
export const SECRET_SCAN_MAX_PER_PATTERN = 3

// ─── Subagent parsing ─────────────────────────────────────────────────────────

/**
 * Cap on subagent transcripts parsed concurrently for one session. A single
 * session can spawn hundreds; an unbounded fan-out opens that many file
 * handles at once and starves the event loop.
 */
export const SUBAGENT_PARSE_CONCURRENCY = 6

// ─── Tray popover ─────────────────────────────────────────────────────────────

/** A session counts as live if it was written to within this window. */
export const ACTIVE_SESSION_MS = 60_000

/**
 * How often a surface showing a live indicator re-judges it against the
 * clock. Shared by the dashboard row and the tray popover so both age a
 * session out at the same moment.
 */
export const LIVE_REFRESH_INTERVAL_MS = 15_000

/** How many finished sessions the tray lists under "Recent". */
export const TRAY_RECENT_SESSION_COUNT = 3

/**
 * How long a session whose turn is still OPEN (a tool call waiting for its
 * result, or a prompt the assistant has not answered yet) stays live after its
 * last write. Claude Code writes nothing while a tool runs or a long response
 * generates, and measured over three days of real history a session went
 * silent mid-turn for over a minute roughly ten times per session — so the
 * short `ACTIVE_SESSION_MS` window alone drops the live indicator while
 * Claude is still working. Ten minutes matches the longest run a single tool
 * call is allowed; past it an open turn is taken to be abandoned (a killed
 * process, an interrupted prompt) rather than still running.
 */
export const OPEN_TURN_ACTIVE_MS = 10 * 60_000
