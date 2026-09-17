/**
 * Whether the test setup should drop an inherited `CLAUDE_CONFIG_DIR`.
 *
 * Unit runs must not depend on the contributor's shell, so they clear it (see
 * setup.ts). The opt-in real-history verification (`pnpm verify:accounting`,
 * which sets VERIFY_ACCOUNTING=1) is the exception: there the variable is how
 * a contributor picks which history to verify, and clearing it would silently
 * verify `~/.claude` instead.
 */
export function shouldClearClaudeConfigDir(env: NodeJS.ProcessEnv): boolean {
  return env.VERIFY_ACCOUNTING !== '1'
}
