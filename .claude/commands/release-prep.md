---
description: Prepare a ClaudeWatch release — readiness report, then the hand-cut release steps
allowed-tools: Bash(.claude/hooks/release-check.sh *), Bash(git *), Bash(pnpm *)
---

You are preparing a ClaudeWatch release. Optional argument: the version to release, e.g. `1.2.0` — `$ARGUMENTS`.

## How releases work here

The version is bumped **by hand**, not by `scripts/release.mjs` (which has never been used in this repo):

1. Bump `version` in `package.json` on a feature/chore branch or on `develop`, and commit it, along with a regenerated `CHANGELOG.md`.
2. Merge that branch into `develop`.
3. Merge `develop` into `main` via PR. That merge commit is what gets tagged.
4. On `main`, create an annotated tag named exactly after the version in `package.json`.
5. Push the tag to trigger `.github/workflows/release.yml`.

No back-merge from `main` into `develop`. The tag name must equal the `version` in `package.json` at the tagged commit.

## Current readiness (git-only snapshot, generated now)

!`.claude/hooks/release-check.sh report --no-checks`

## What to do

1. Read the snapshot. For every `FAIL` item, fix it or tell me exactly what I need to do. Never merge or push on my behalf without asking.
2. Work out which step I am on from the branch in the snapshot, and give me only that step's instructions:
   - **Feature branch or `develop`** — the bump step. Confirm the version in `package.json` is the one we want, and that `CHANGELOG.md` leads with it. If I passed an argument, use that version. Otherwise compare what is in `package.json` against the bump the commits suggest, and say whether they agree.
   - **`main`** — the tagging step. Run `.claude/hooks/release-check.sh report --full`, which adds `dedupe --check`, `build` and `size-check` to the checks `ci.yml` runs. The Release workflow runs none of them, so this is the last gate before a published build.
3. Summarize the unreleased commits since the last tag, grouped as they will appear in `CHANGELOG.md` (feat → Features, fix/perf/revert → Bug Fixes; docs and refactor are shown, chore/ci/test/style hidden). Flag any commit whose subject is not conventional — it drops out of the changelog silently.
4. List the exact commands for me to run, in order, and stop. Do not run any of them unless I say so.

Never edit `CHANGELOG.md` or the `version` in `package.json` unless I ask you to — and if I do ask, remember the version you write is the one that must be tagged verbatim later.
