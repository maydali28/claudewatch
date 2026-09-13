#!/usr/bin/env bash
# Release-readiness checks for ClaudeWatch.
#
# Shared by the Claude Code hooks in .claude/settings.json and by the
# /release-prep command.
#
# ── The release flow this encodes ────────────────────────────────────────────
# Releases here are cut by hand, NOT by scripts/release.mjs (which has never
# been used — there is no "chore(release):" commit anywhere in the history):
#
#   1. Bump "version" in package.json yourself, on a feature/chore branch or
#      directly on develop, and commit it.
#   2. Merge that branch into develop.
#   3. Merge develop into main via PR. The merge commit on main is the one
#      that gets tagged.
#   4. On main: create an annotated tag whose name is exactly the version
#      already sitting in package.json.
#   5. Push that tag — it triggers .github/workflows/release.yml.
#
# No back-merge from main into develop is needed: the bump reached main
# through develop, so both branches already carry it. Verified against v1.1.1
# and v1.1.4, each of which tags a "Merge pull request ... from
# maydali28/develop" commit whose package.json already held the matching
# version.
#
# The invariant every check defends: the tag name equals the version in
# package.json at the tagged commit. The in-app updater feed, the Homebrew
# cask and the generated update manifests are all keyed on that agreement.
#
# Usage:
#   release-check.sh report [--full] [--no-checks]
#       Human-readable report. Exit 0 when ready, 1 when something blocks.
#       --full adds the slow CI steps (dedupe --check, build, size-check).
#       --no-checks skips typecheck/lint/test entirely (git-only snapshot).
#   release-check.sh gate
#       PreToolUse(Bash) hook. When the command tags or publishes a release it
#       runs the report and denies the call while anything blocks. If the
#       command names an explicit version, that version is checked against
#       package.json.
#   release-check.sh context
#       UserPromptSubmit hook. When the prompt talks about releasing, prints a
#       git-only snapshot to stdout so Claude starts from the real state.
#   release-check.sh guard
#       PreToolUse(Edit|Write) hook. Informational only: when the version in
#       package.json or CHANGELOG.md is edited, it restates what the new value
#       has to line up with. It never blocks — bumping by hand IS the process.

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] && cd "$ROOT" || exit 0

MODE="${1:-report}"
shift || true
FULL=0
RUN_CHECKS=1
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --no-checks) RUN_CHECKS=0 ;;
  esac
done

# Set by gate mode when the command names an explicit version (e.g. v1.2.0).
TARGET_TAG=""
# Set by gate mode to the kind of release command seen:
#   manual-tag — creating or pushing a tag, the flow this repo uses
#   scripted   — pnpm release / pnpm publish / electron-forge publish
GATE_KIND=""

PASS=()
WARN=()
FAIL=()
ok()   { PASS+=("$1"); }
warn() { WARN+=("$1"); }
fail() { FAIL+=("$1"); }

# a <= b, semver-ish, via version sort.
ver_le() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]; }

# ── Git state ────────────────────────────────────────────────────────────────
collect_git_state() {
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  PKG_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo '0.0.0')"

  # Which step of the flow are we on? The checks differ sharply between
  # "bumping the version" and "tagging the merge commit on main".
  case "$BRANCH" in
    main|master) PHASE="tag" ;;
    develop)     PHASE="integrate" ;;
    *)           PHASE="feature" ;;
  esac

  LAST_TAG="$(git tag --list 'v*' --sort=-v:refname 2>/dev/null | head -n1)"
  LAST_VERSION="${LAST_TAG#v}"
  [ -n "$LAST_VERSION" ] || LAST_VERSION="0.0.0"

  # ── Gate policy ───────────────────────────────────────────────────────────
  # Only reached when a release command is actually being run.
  if [ "$GATE_KIND" = "scripted" ]; then
    fail "this repo does not use the scripted release. 'pnpm release' (scripts/release.mjs) bumps package.json again, regenerates the changelog, and commits 'chore(release)' + tags on main — leaving main with a bump commit develop never sees. Here the version is bumped by hand and merged through develop; on main you only create the tag. Run the tag command instead, or invoke the script yourself outside this session if you really mean to switch flows."
  fi
  if [ -n "$GATE_KIND" ] && [ "$PHASE" != "tag" ]; then
    fail "tags are cut on main, but HEAD is '$BRANCH'. A tag here would point at a branch commit rather than the develop → main merge commit that every previous release tags. Merge to main and check it out first."
  fi

  # ── Working tree ──────────────────────────────────────────────────────────
  # A tag must point at a commit containing everything you meant to ship, so
  # uncommitted work blocks at tag time but is merely noise earlier.
  local dirty entries untracked
  dirty="$(git status --porcelain 2>/dev/null)"
  if [ -z "$dirty" ]; then
    ok "working tree clean"
  else
    entries="$(printf '%s\n' "$dirty" | wc -l | tr -d ' ')"
    untracked="$(printf '%s\n' "$dirty" | grep -c '^??' || true)"
    if [ "$PHASE" = "tag" ]; then
      fail "working tree not clean ($entries entries, $untracked untracked) — the tag would not contain this work; commit or stash first"
    else
      warn "working tree not clean ($entries entries, $untracked untracked)"
    fi
  fi

  # ── Remote sync ───────────────────────────────────────────────────────────
  # Best effort: no network must not become a false block.
  local fetched=0
  if GIT_SSH_COMMAND="ssh -o ConnectTimeout=10 -o BatchMode=yes" \
     git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 fetch --quiet origin 2>/dev/null; then
    fetched=1
  else
    warn "could not fetch origin — remote checks below use the last known state"
  fi

  if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    local counts ahead behind upstream
    upstream="$(git rev-parse --abbrev-ref '@{u}')"
    counts="$(git rev-list --left-right --count 'HEAD...@{u}' 2>/dev/null || echo '0 0')"
    ahead="${counts%%[[:space:]]*}"
    behind="${counts##*[[:space:]]}"
    if [ "$behind" != "0" ]; then
      fail "$behind commit(s) behind $upstream — pull first, or the tag lands on a stale commit"
    elif [ "$ahead" != "0" ]; then
      if [ "$PHASE" = "tag" ]; then
        fail "$ahead unpushed commit(s) on $BRANCH — push main first so the tag points at a commit that exists on origin"
      else
        warn "$ahead unpushed commit(s) on $BRANCH"
      fi
    else
      ok "in sync with $upstream"
    fi
  else
    warn "no upstream configured for $BRANCH"
  fi

  # ── develop → main integration ────────────────────────────────────────────
  if [ "$PHASE" = "tag" ] && git rev-parse --verify --quiet origin/develop >/dev/null; then
    local pending
    pending="$(git rev-list --count HEAD..origin/develop 2>/dev/null || echo 0)"
    if [ "$pending" = "0" ]; then
      ok "origin/develop fully merged into $BRANCH"
    else
      fail "origin/develop has $pending commit(s) not in $BRANCH — merge the develop → $BRANCH PR before tagging"
    fi
  fi

  # ── Commits since the last release ────────────────────────────────────────
  local range subjects
  if [ -z "$LAST_TAG" ]; then
    warn "no v* tag found — first release?"
    range="HEAD"
  else
    range="$LAST_TAG..HEAD"
  fi
  COMMIT_COUNT="$(git rev-list --count --no-merges "$range" 2>/dev/null || echo 0)"
  subjects="$(git log --no-merges --format='%s%n%b' "$range" 2>/dev/null)"
  FEAT_COUNT="$(printf '%s\n' "$subjects" | grep -cE '^feat(\(.+\))?!?:' || true)"
  FIX_COUNT="$(printf '%s\n' "$subjects" | grep -cE '^(fix|perf|revert)(\(.+\))?!?:' || true)"
  BREAKING_COUNT="$(printf '%s\n' "$subjects" | grep -cE '(^[a-z]+(\(.+\))?!:|BREAKING CHANGE)' || true)"
  NONCONV="$(git log --no-merges --format='%h %s' "$range" 2>/dev/null \
    | grep -vE '^[0-9a-f]+ (feat|fix|perf|revert|docs|style|refactor|test|chore|ci|build)(\(.+\))?!?: ' || true)"

  if [ "$COMMIT_COUNT" = "0" ]; then
    if [ "$PHASE" = "tag" ]; then
      fail "no commits since $LAST_TAG — nothing to release"
    else
      warn "no commits since $LAST_TAG"
    fi
  else
    ok "$COMMIT_COUNT commit(s) since ${LAST_TAG:-the beginning}: $FEAT_COUNT feat, $FIX_COUNT fix/perf/revert"
  fi
  if [ -n "$NONCONV" ]; then
    warn "commit(s) not in conventional format (they will be missing from the changelog):"$'\n'"$(printf '%s\n' "$NONCONV" | sed 's/^/      /')"
  fi

  # Bump suggestion from conventional-commit semantics. Advisory only — you
  # pick the number by hand; nothing computes it for you in this flow.
  local maj min pat
  IFS=. read -r maj min pat <<<"$LAST_VERSION"
  maj="${maj:-0}"; min="${min:-0}"; pat="${pat:-0}"
  if [ "$BREAKING_COUNT" != "0" ]; then
    BUMP="major"; SUGGESTED="$((maj + 1)).0.0"
  elif [ "$FEAT_COUNT" != "0" ]; then
    BUMP="minor"; SUGGESTED="$maj.$((min + 1)).0"
  else
    BUMP="patch"; SUGGESTED="$maj.$min.$((pat + 1))"
  fi

  # ── The core invariant: package.json version vs the tag ───────────────────
  RELEASE_TAG="v$PKG_VERSION"

  if [ -n "$TARGET_TAG" ]; then
    # gate mode found an explicit version in the command being run.
    if [ "$TARGET_TAG" = "v$PKG_VERSION" ]; then
      ok "tag $TARGET_TAG matches package.json $PKG_VERSION"
    else
      fail "tag $TARGET_TAG does not match package.json $PKG_VERSION — the tag name and the shipped version must agree (the updater feed, Homebrew cask and update manifests are keyed on it). Either tag v$PKG_VERSION, or set package.json to ${TARGET_TAG#v} first."
    fi
    RELEASE_TAG="$TARGET_TAG"
  fi

  if git rev-parse --verify --quiet "refs/tags/v$PKG_VERSION" >/dev/null; then
    if [ "$PHASE" = "tag" ]; then
      fail "v$PKG_VERSION is already tagged — package.json was not bumped for this release. Bump it (commits since $LAST_TAG suggest $SUGGESTED), merge through develop, then tag."
    else
      warn "package.json is still $PKG_VERSION, which is already tagged — bump it before merging to main (commits suggest $SUGGESTED)"
    fi
  elif [ -n "$LAST_TAG" ] && ver_le "$PKG_VERSION" "$LAST_VERSION"; then
    fail "package.json $PKG_VERSION is not newer than the last tag $LAST_TAG — bump it (commits suggest $SUGGESTED)"
  else
    ok "package.json $PKG_VERSION is unreleased — it will be tagged as v$PKG_VERSION"
    if [ "$PKG_VERSION" != "$SUGGESTED" ]; then
      warn "commits since ${LAST_TAG:-the beginning} suggest $SUGGESTED (a $BUMP bump); package.json says $PKG_VERSION — fine if deliberate, just confirming the shape of the release"
    fi
  fi

  if [ "$fetched" = "1" ] && git ls-remote --exit-code --tags origin "refs/tags/$RELEASE_TAG" >/dev/null 2>&1; then
    fail "$RELEASE_TAG already exists on origin"
  fi

  # ── CHANGELOG ─────────────────────────────────────────────────────────────
  # `pnpm changelog` prepends a section for the commits since the last tag, and
  # extract-release-notes.mjs feeds the TOP section into the GitHub Release
  # body. A stale top section ships the wrong notes.
  if [ -f CHANGELOG.md ]; then
    local top
    top="$(grep -m1 -E '^## ' CHANGELOG.md | awk '{print $2}')"
    if [ "$top" = "$PKG_VERSION" ]; then
      ok "CHANGELOG.md top section is $PKG_VERSION"
    elif [ "$PHASE" = "tag" ]; then
      fail "CHANGELOG.md top section is ${top:-empty}, but you are releasing $PKG_VERSION — run 'pnpm changelog' and commit it, or the GitHub Release body will carry the ${top:-previous} notes"
    else
      warn "CHANGELOG.md top section is ${top:-empty}, not $PKG_VERSION — run 'pnpm changelog' before merging to main (it currently also lags the last tag $LAST_TAG)"
    fi
  else
    fail "CHANGELOG.md missing — extract-release-notes.mjs needs it"
  fi
  return 0
}

# ── Release pipeline prerequisites ───────────────────────────────────────────
# Files the Release workflow and its reusable publish workflows read. A missing
# placeholder here fails the pipeline only after the platform builds finished.
collect_pipeline_state() {
  local f
  for f in scripts/generate-update-manifests.mjs scripts/extract-release-notes.mjs scripts/build-apt-repo.mjs .syft.yaml; do
    [ -f "$f" ] && ok "pipeline file present: $f" || fail "pipeline file missing: $f (referenced by .github/workflows)"
  done
  if [ -f homebrew/claudewatch.rb ]; then
    if grep -q '__VERSION__' homebrew/claudewatch.rb && grep -q '__SHA256__' homebrew/claudewatch.rb; then
      ok "homebrew cask template has its __VERSION__/__SHA256__ placeholders"
    else
      fail "homebrew/claudewatch.rb lost its __VERSION__/__SHA256__ placeholders — publish-homebrew.yml would push a broken cask"
    fi
  else
    fail "homebrew/claudewatch.rb missing (publish-homebrew.yml renders it)"
  fi
  if [ -f scripts/install.sh ]; then
    grep -q '__FINGERPRINT__' scripts/install.sh \
      && ok "install.sh keeps its __FINGERPRINT__ placeholder" \
      || fail "scripts/install.sh has no __FINGERPRINT__ placeholder — publish-apt-repo.yml refuses to publish an unpinned installer"
  fi

  local want_pnpm have_pnpm node_major
  want_pnpm="$(node -p "(require('./package.json').packageManager||'').split('@')[1]||''" 2>/dev/null)"
  have_pnpm="$(pnpm --version 2>/dev/null || echo '?')"
  [ -n "$want_pnpm" ] && [ "$want_pnpm" != "$have_pnpm" ] \
    && warn "local pnpm $have_pnpm differs from packageManager pnpm@$want_pnpm (CI uses the latter)"
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$node_major" != "22" ] && warn "local node $(node --version 2>/dev/null) — CI builds on node 22"
  return 0
}

# ── CI checks ────────────────────────────────────────────────────────────────
# release.yml does NOT run these; only ci.yml does, on push. A red main still
# gets built and published if a tag is pushed, so run the same gate first.
run_check() {
  local label="$1"; shift
  local log
  log="$(mktemp -t claudewatch-release-check.XXXXXX)"
  if "$@" >"$log" 2>&1; then
    ok "$label"
  else
    fail "$label failed:"$'\n'"$(tail -n 15 "$log" | sed 's/^/      /')"
  fi
  rm -f "$log"
}

collect_checks() {
  # In a fresh worktree (or before a first install) every script would fail for
  # the same uninteresting reason. Say that once instead of five times.
  if [ ! -d node_modules ]; then
    warn "node_modules missing — skipped typecheck/lint/format/depcruise/test; run 'pnpm install --frozen-lockfile' and re-check before tagging"
    return 0
  fi
  run_check "pnpm typecheck"     pnpm -s typecheck
  run_check "pnpm lint"          pnpm -s lint
  run_check "pnpm format:check"  pnpm -s format:check
  run_check "pnpm depcruise"     pnpm -s depcruise
  run_check "pnpm test"          pnpm -s test
  if [ "$FULL" = "1" ]; then
    run_check "pnpm dedupe --check" pnpm -s dedupe --check
    run_check "pnpm build"          pnpm -s build
    run_check "pnpm size-check"     pnpm -s size-check
  fi
  return 0
}

# ── Report rendering ─────────────────────────────────────────────────────────
render_report() {
  local phase_label
  case "$PHASE" in
    tag)       phase_label="on main — tagging step" ;;
    integrate) phase_label="on develop — integration step" ;;
    *)         phase_label="on a feature branch — bump and tag not due yet" ;;
  esac
  printf 'Release readiness — claudewatch, package.json v%s, branch %s (%s)\n' \
    "$PKG_VERSION" "$BRANCH" "$phase_label"
  local item
  for item in "${PASS[@]-}"; do [ -n "$item" ] && printf '  OK   %s\n' "$item"; done
  for item in "${WARN[@]-}"; do [ -n "$item" ] && printf '  WARN %s\n' "$item"; done
  for item in "${FAIL[@]-}"; do [ -n "$item" ] && printf '  FAIL %s\n' "$item"; done

  printf '\nVersion: package.json says %s, so the tag to create is v%s.\n' "$PKG_VERSION" "$PKG_VERSION"
  printf 'Commits since %s suggest %s (a %s bump) — advisory only, you choose the number.\n' \
    "${LAST_TAG:-the beginning}" "$SUGGESTED" "$BUMP"
  if [ "${#FAIL[@]}" -eq 0 ]; then
    printf 'Verdict: READY (%d warning(s))\n' "${#WARN[@]}"
  else
    printf 'Verdict: NOT READY, %d blocking issue(s)\n' "${#FAIL[@]}"
  fi
  cat <<'STEPS'

Release flow, as actually practiced in this repo (see CONTRIBUTING.md):
  1. Bump "version" in package.json by hand, on your feature/chore branch or
     directly on develop, and commit it. Run "pnpm changelog" and commit
     CHANGELOG.md alongside it so the release notes match.
  2. Merge that branch into develop.
  3. Merge develop into main via PR. The merge commit on main is what gets
     tagged.
  4. On main, pulled and clean, create an annotated tag named exactly after
     the version in package.json.
  5. Push that tag. It triggers .github/workflows/release.yml, which builds
     mac/win/linux, writes the update manifests, runs the SBOM and vuln scan,
     publishes the GitHub Release, then the Homebrew cask and the signed APT
     repo.

  No back-merge from main into develop: the bump reached main through develop,
  so both branches already carry it.

  Note: "pnpm release" (scripts/release.mjs) automates a DIFFERENT flow. It
  bumps, regenerates the changelog, commits "chore(release): vX.Y.Z" and tags,
  all on main. It has never been used here, and running it would put a bump
  commit on main that develop does not have.
STEPS
}

collect_all() {
  collect_git_state
  collect_pipeline_state
  [ "$RUN_CHECKS" = "1" ] && collect_checks
  return 0
}

build_report() {
  collect_all
  render_report
}

# Blank out quoted spans so text inside a string literal cannot look like a
# command. Without this, a ';' inside 'a note; pnpm release is never used'
# reads as a command separator and trips the gate. Shell single quotes cannot
# nest, so the single-quote pass is exact; the double-quote pass is a
# heuristic (an escaped \" inside a double-quoted string can end it early).
# Words are replaced by a space rather than deleted so that surrounding tokens
# do not fuse together. A release command hidden entirely inside quotes, e.g.
# sh -c 'pnpm release', is deliberately not matched: day to day, false alarms
# on ordinary text cost more than that edge case.
strip_quoted_spans() {
  printf '%s' "$1" | sed -E "s/'[^']*'/ /g; s/\"[^\"]*\"/ /g"
}

# Drop heredoc bodies from a command before pattern-matching it. Writing a file
# whose CONTENT documents a release command (this script, CONTRIBUTING.md) must
# not trip the gate — only the command itself counts.
strip_heredoc_bodies() {
  local line term="" inbody=0 trimmed out=""
  local opener='<<-?[[:space:]]*["'"'"']?([A-Za-z_][A-Za-z0-9_]*)["'"'"']?'
  while IFS= read -r line; do
    if [ "$inbody" = "1" ]; then
      trimmed="${line#"${line%%[![:space:]]*}"}"
      [ "$line" = "$term" ] || [ "$trimmed" = "$term" ] && inbody=0
      continue
    fi
    out+="$line"$'\n'
    if [[ "$line" =~ $opener ]]; then
      term="${BASH_REMATCH[1]}"
      inbody=1
    fi
  done <<<"$1"
  printf '%s' "$out"
}

# ── Modes ────────────────────────────────────────────────────────────────────
case "$MODE" in
  report)
    build_report
    [ "${#FAIL[@]}" -eq 0 ]
    ;;

  gate)
    INPUT="$(cat)"
    CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
    [ -z "$CMD" ] && exit 0
    # Two views of the command: BARE still holds quoted text (so an explicit
    # "v1.2.0" is still findable), SCAN has quoted spans blanked for matching.
    BARE="$(strip_heredoc_bodies "$CMD")"
    SCAN="$(strip_quoted_spans "$BARE")"
    # Commands that tag or publish a release. Each alternative must start a
    # command segment (line start, or after ; & |) so that echoing or grepping
    # the words does not trip the gate. Plain `git tag` (listing) and pushes of
    # ordinary branches are left alone.
    SEG='(^|[;&|])[[:space:]]*'
    # The flow this repo uses: create or push a version tag.
    MANUAL_RE="${SEG}(git[[:space:]]+tag[[:space:]]+(-a|-s|-m|-f|v?[0-9])|git[[:space:]]+push[[:space:]].*(--tags|--follow-tags|[[:space:]]v[0-9]+\.[0-9]+\.[0-9]+))"
    # The scripted flow, which this repo has never used.
    SCRIPTED_RE="${SEG}((pnpm|npm run|yarn)[[:space:]]+(release|publish)([[:space:]]|$)|node[[:space:]]+scripts/release\.mjs|(npx[[:space:]]+)?electron-forge[[:space:]]+publish)"
    if printf '%s\n' "$SCAN" | grep -qE "$SCRIPTED_RE"; then
      GATE_KIND="scripted"
    elif printf '%s\n' "$SCAN" | grep -qE "$MANUAL_RE"; then
      GATE_KIND="manual-tag"
    else
      exit 0
    fi

    # Pull an explicit vX.Y.Z out of the command so the tag/package.json
    # agreement is checked against the value actually being used. Prefer the
    # unquoted view, then fall back to the quoted one for `git tag -a "v1.2.0"`.
    TARGET_TAG="$(printf '%s\n' "$SCAN" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
    [ -n "$TARGET_TAG" ] || TARGET_TAG="$(printf '%s\n' "$BARE" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"

    # Collect in this shell — a $(...) subshell would drop the arrays.
    collect_all
    REPORT="$(render_report)"
    if [ "${#FAIL[@]}" -eq 0 ]; then
      jq -n --arg r "$REPORT" --arg w "${#WARN[@]}" '{
        systemMessage: ("Release gate passed with \($w) warning(s) — readiness report added to context."),
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ("Release gate ran before this command.\n\n" + $r) }
      }'
    else
      jq -n --arg r "$REPORT" '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: ("Release gate blocked this command. Fix the FAIL items, then retry.\n\n" + $r)
        }
      }'
    fi
    ;;

  context)
    INPUT="$(cat)"
    PROMPT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)"
    printf '%s' "$PROMPT" | grep -qiE '(\brelease|cut (a )?(new )?version|bump (the )?version|\btag v?[0-9]|changelog|publish (the )?app|ship (it|v[0-9]))' || exit 0
    RUN_CHECKS=0
    echo "Release readiness snapshot (auto-injected by .claude/hooks/release-check.sh; run '.claude/hooks/release-check.sh report --full' for the version that also runs typecheck, lint, test and build):"
    echo
    build_report
    exit 0
    ;;

  guard)
    # Informational only. Bumping the version by hand IS the process here, so
    # this never blocks — it restates what the new value has to line up with,
    # at the moment it is being typed.
    INPUT="$(cat)"
    FILE="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
    [ -z "$FILE" ] && exit 0
    BASE="$(basename "$FILE")"
    NOTE=""
    if [ "$BASE" = "CHANGELOG.md" ]; then
      NOTE="CHANGELOG.md is normally generated by 'pnpm changelog', which prepends a section covering the commits since the last tag. extract-release-notes.mjs feeds the TOP section into the GitHub Release body, so whatever ends up first is what users read — keep that heading equal to the version being released."
    elif [ "$BASE" = "package.json" ]; then
      TOUCHES_VERSION="$(printf '%s' "$INPUT" | jq -r '[.tool_input.old_string // "", .tool_input.new_string // "", .tool_input.content // ""] | map(test("\"version\"[[:space:]]*:")) | any' 2>/dev/null)"
      if [ "$TOUCHES_VERSION" = "true" ]; then
        LAST_TAG="$(git tag --list 'v*' --sort=-v:refname 2>/dev/null | head -n1)"
        NOTE="Version bump: this number is what must later be tagged verbatim on main, so the tag and package.json agree. Last released tag is ${LAST_TAG:-none}. The bump belongs on a feature/chore branch or on develop and reaches main through the develop to main PR — do not add a separate bump commit on main. Run 'pnpm changelog' alongside it so the release notes match."
      fi
    fi
    [ -z "$NOTE" ] && exit 0
    jq -n --arg n "$NOTE" '{
      systemMessage: "Release note added to context.",
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $n }
    }'
    ;;

  *)
    echo "unknown mode: $MODE (expected report|gate|context|guard)" >&2
    exit 64
    ;;
esac
