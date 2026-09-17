/**
 * Vitest global setup — runs before every test file.
 *
 * `CLAUDE_CONFIG_DIR` relocates the Claude directory, and `claude-paths.ts`
 * reads it from `process.env` when it resolves. A contributor who exports that
 * variable in their shell therefore changed what the suite tested: the
 * `project-scanner` wiring tests scanned their real `~/.claude` instead of the
 * temp fixture home and failed, and every other suite that runs the real
 * resolver quietly read their machine's history.
 *
 * The suite has to describe the code, not the developer's shell, so the
 * variable is removed here — at load, before any module can resolve a path
 * from it, and again before each test. Tests that need it set it themselves,
 * inside the test, which still works: this only clears what the environment
 * brought in.
 */
import { beforeEach } from 'vitest'

delete process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
})
