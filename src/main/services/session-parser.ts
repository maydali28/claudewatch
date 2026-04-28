// Barrel re-export — the parser was split into focused modules under
// `parsers/` so each file stays under ~400 lines. Existing callers still
// import from `services/session-parser` to avoid a churn-only rename.

export { parseSessionMetadata } from './parsers/metadata-parser'
export { parseSessionFull } from './parsers/full-parser'
export { parseSubagents } from './parsers/subagent-parser'
