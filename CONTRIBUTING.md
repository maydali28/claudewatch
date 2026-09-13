# Contributing to ClaudeWatch

Thanks for your interest in contributing. This document is the long-form version of the [README's Contributing section](README.md#contributing) — read that first for the quick-start, then come back here for the conventions you'll need before opening a PR.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Coding Conventions](#coding-conventions)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Releasing](#releasing)
- [Reporting Issues](#reporting-issues)
- [Reporting Security Vulnerabilities](#reporting-security-vulnerabilities)

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## Development Setup

### Prerequisites

- Node.js 20 or newer (see [`.nvmrc`](.nvmrc))
- pnpm 10 or newer (the version is pinned via the `packageManager` field in [package.json](package.json))
- Git

### Clone and install

```bash
git clone https://github.com/your-fork/claudewatch.git
cd claudewatch
pnpm install
```

### Environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your values. `.env.local` is gitignored — never commit it. The full reference for every variable is in the [README](README.md#environment-variables).

### Run in development

```bash
pnpm dev
```

Hot reload is wired for both the main process and the renderer. The tray icon will appear in your system tray.

### Verify your changes

Before pushing:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm depcruise
pnpm size-check
```

The same commands run in CI on every PR — running them locally is the fastest way to keep your feedback loop tight.

## Architecture Overview

ClaudeWatch is an Electron app with strict process boundaries enforced by [dependency-cruiser](.dependency-cruiser.cjs):

- **`src/main/`** — Node.js / Electron main process. File watching, parsing, IPC handlers, persistent state.
- **`src/renderer/`** — Sandboxed React renderer. Talks to main only through the `window.claudewatch` bridge.
- **`src/preload/`** — Context bridge that exposes the typed IPC surface to the renderer.
- **`src/shared/`** — Types, IPC contracts, constants, and pure utilities. Imported by both processes — must stay platform-agnostic (no `electron`, no `node:*` imports).

Boundary rules:

- The renderer never imports from `src/main/`. Use IPC.
- The main process never imports from `src/renderer/`. Use push events.
- `src/shared/` never imports from `electron` or Node-only modules.

`pnpm depcruise` enforces all of the above. If your change crosses a boundary, the build will fail before review.

For more detail on the IPC layer see the [IPC Architecture section in the README](README.md#ipc-architecture).

## Coding Conventions

- **TypeScript strict mode is non-negotiable.** Avoid `any` unless there is no other way to type something — and add a comment explaining why when you do.
- **Services live in `src/main/services/`.** Each service should be a focused module under ~500 lines. Pure logic (parsers, analytics, lint rules) goes in services so it stays unit-testable without Electron.
- **UI components live in `src/renderer/src/components/`** and follow the existing per-feature folder layout (`sessions/`, `analytics/`, `config/`, etc.).
- **Shared types go in `src/shared/types/`** so both processes can import them without circular dependencies.
- **New lint rules** go in `src/main/services/lint-rules/` and must be registered in `src/shared/constants/lint-rules.ts`.
- **New IPC channels** must be declared in three places: `src/shared/ipc/channels.ts` (the constant), `src/shared/ipc/contracts.ts` (the request/response types), and `src/preload/api.ts` (the typed wrapper). Validation schemas go in `src/shared/ipc/schemas.ts`.
- **Never throw across IPC.** Wrap every handler in `try { ... ok(...) } catch (e) { return err(toSafeError(e), CODE) }` — the renderer relies on the `Result<T>` discriminated union.
- **Never expose Node primitives to the renderer.** All renderer access to the file system, IPC, or Electron APIs goes through `window.claudewatch`.
- **Comments explain WHY, not WHAT.** Default to no comments. Only add one when a future reader couldn't reconstruct the reasoning from the code alone.

### Formatting

Prettier and ESLint configurations are committed. Run `pnpm format` to auto-format and `pnpm lint:fix` to auto-fix lint issues. A `lint-staged` pre-commit hook runs both on staged files automatically.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) — `commitlint` enforces the format on every commit, and the changelog is generated from commit messages.

Use one of: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `style:`, `revert:`.

Example:

```
feat(sessions): add full-text search across all projects

Implements sessions:search by readline-scanning every JSONL file under
~/.claude/projects/. Results are returned with line numbers and project
context so the renderer can deep-link into the conversation viewer.
```

If you'd rather not memorise the format, run `pnpm commit` — it launches an interactive prompt (`commitizen`) that builds a compliant message for you.

## Pull Requests

1. **Branch from `main`.** Use a descriptive prefix that matches the [CI branch filter](.github/workflows/ci.yml): `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `style/`, `perf/`, `test/`, `build/`, `ci/`, `hotfix/`, or `revert/`.

2. **Keep PRs focused.** One concern per PR. Refactors get their own PR — don't bundle them with feature work.

3. **Fill in the PR template.** The [pull request template](.github/pull_request_template.md) is required reading; the checklist at the bottom is non-negotiable.

4. **Title using a Conventional Commit prefix** — the same prefixes as commit messages: `feat: ...`, `fix: ...`, etc.

5. **Describe what changed and why**, not just what the diff shows. Reference any related issues with `Closes #123` or `Fixes #123`.

6. **CI must be green.** PRs with failing typecheck, lint, format, test, build, depcruise, or bundle-size jobs will not be reviewed.

7. **Expect feedback.** Reviews focus on correctness, security, and architectural fit. Address comments by pushing new commits — don't force-push until the review is approved.

## Releasing

Releases follow gitflow, and the version is bumped **by hand**: feature branches merge into `develop`, `develop` merges into `main` via PR, and a version tag on that merge commit triggers the build.

1. **Bump `version` in `package.json` yourself**, on your feature/chore branch or directly on `develop`, and commit it. Run `pnpm changelog` and commit `CHANGELOG.md` in the same breath so the release notes match the version.

   > **Run `pnpm changelog` against `main`, not `develop`.** Version tags sit on the `develop → main` merge commits, and because nothing is ever merged back from `main`, those commits are not ancestors of `develop`. From `develop` the newest reachable tag is `v1.0.0`, so `conventional-changelog` walks every commit since 1.0.0 and re-lists features that already shipped. Generate the file while `main` is checked out, then carry the result on your branch.
2. Merge that branch into `develop`.
3. Merge `develop` into `main` via PR. `commitlint` runs on the PR; CI (`ci.yml`) runs on the push. The resulting merge commit on `main` is what gets tagged.
4. On an up-to-date, clean `main`, tag it with exactly the version already in `package.json`:

   ```bash
   git checkout main && git pull
   git tag -a v1.2.3 -m "Release v1.2.3"   # v1.2.3 == package.json version
   git push origin v1.2.3
   ```

5. The tag push runs [release.yml](.github/workflows/release.yml): macOS (signed + notarized), Windows and Linux builds, update manifests for the in-app updater, an SBOM with a vulnerability scan that fails the release on high severity, the GitHub Release with notes taken from the top `CHANGELOG.md` section, then the Homebrew cask and the signed APT repository.

**The tag name must equal the `version` in `package.json` at the tagged commit.** The in-app updater feed, the Homebrew cask and the generated update manifests are all keyed on that agreement.

There is **no back-merge** from `main` into `develop`: the bump travelled to `main` through `develop`, so both branches already carry it.

`pnpm release` ([scripts/release.mjs](scripts/release.mjs)) automates a *different* flow — it bumps, regenerates the changelog, commits `chore(release): vX.Y.Z` and tags, all on `main`. It has never been used here, and running it would leave `main` with a bump commit `develop` never sees.

The Release workflow does **not** run typecheck, lint, or tests, so make sure CI on `main` is green before tagging.

### Claude Code release helpers

The repo ships project-level Claude Code hooks in [.claude/settings.json](.claude/settings.json), backed by [.claude/hooks/release-check.sh](.claude/hooks/release-check.sh):

- **Release gate** (`PreToolUse` on Bash): before a tag is created or pushed, the hook checks that you are on `main`, the tree is clean, `main` is in sync with origin, `origin/develop` is fully merged, the tag name matches `package.json`, the version is not already tagged, `CHANGELOG.md` leads with that version, the pipeline placeholder files are intact, and typecheck/lint/format/depcruise/test pass. It blocks the command while any of that fails. It also blocks `pnpm release` and `pnpm publish`, since this repo does not use the scripted flow.
- **Readiness context** (`UserPromptSubmit`): when a prompt mentions releasing, a git-only snapshot of the same report is injected so Claude starts from the real state.
- **Version-bump note** (`PreToolUse` on Edit/Write): informational only. Editing the `version` in `package.json` or `CHANGELOG.md` adds a reminder of what the value must line up with. It never blocks — bumping by hand is the process.
- **`/release-prep`**: a slash command that prints the report, runs the full gate (including `dedupe --check`, `build`, and `size-check`), summarizes the unreleased commits, and lists the exact commands to run.

You can also run the report directly: `.claude/hooks/release-check.sh report --full`.

## Reporting Issues

Open an issue at [github.com/maydali28/claudewatch/issues](https://github.com/maydali28/claudewatch/issues) with:

- OS and version (e.g. macOS 14.5, Windows 11 23H2, Ubuntu 22.04)
- ClaudeWatch version (visible in **Help → About**)
- Steps to reproduce — be precise
- Expected vs. actual behaviour
- Relevant log snippets (right-click the tray icon → **Show Logs**)

Issue templates for bug reports and feature requests live in [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/) — pick the one that fits.

## Reporting Security Vulnerabilities

**Do not** open a public GitHub issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the private disclosure process.

---

Thanks for helping make ClaudeWatch better.
