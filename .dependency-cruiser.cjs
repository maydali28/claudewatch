/**
 * dependency-cruiser configuration for ClaudeWatch.
 *
 * Enforces the import boundaries that are core to the Electron architecture:
 *   - the renderer (sandbox) must never import from the main process
 *   - the main process must not import from the renderer bundle
 *   - both sides may freely import from `src/shared/`
 *   - `src/shared/` must stay free of Electron / Node-only APIs
 *
 * Run: pnpm depcruise
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-renderer-from-main',
      severity: 'error',
      comment:
        "The main process must never import renderer code. Use IPC contracts in 'src/shared/ipc' to communicate.",
      from: { path: '^src/main/' },
      to: { path: '^src/renderer/' },
    },
    {
      name: 'no-main-from-renderer',
      severity: 'error',
      comment:
        "The renderer (sandboxed) cannot reach into main-process modules. Use 'window.claudewatch' (preload bridge) instead.",
      from: { path: '^src/renderer/' },
      to: { path: '^src/main/' },
    },
    {
      name: 'no-electron-in-shared',
      severity: 'error',
      comment:
        "Modules under 'src/shared' are imported by both processes — keep them platform-agnostic. No Electron, no Node-only APIs.",
      from: { path: '^src/shared/' },
      to: { path: '^(electron|node:)' },
    },
    {
      name: 'no-electron-in-renderer',
      severity: 'error',
      comment:
        "Renderer code must not import 'electron' directly — it runs in a sandbox. Use the preload bridge.",
      from: { path: '^src/renderer/' },
      to: { path: '^electron$' },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular module dependencies make refactoring fragile and obscure data flow.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: "Production code must not depend on test fixtures.",
      from: { pathNot: '\\.(spec|test)\\.[jt]sx?$' },
      to: { path: '\\.(spec|test)\\.[jt]sx?$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
      text: { highlightFocused: true },
    },
  },
}
