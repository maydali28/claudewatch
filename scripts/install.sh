#!/usr/bin/env bash
#
# ClaudeWatch installer for Debian/Ubuntu.
#
# Usage (recommended):
#   curl -fsSL https://maydali28.github.io/claudewatch/install.sh | sudo bash
#
# Or, audit before running (encouraged):
#   curl -fsSL https://maydali28.github.io/claudewatch/install.sh -o install.sh
#   less install.sh
#   sudo bash install.sh
#
# Flags:
#   --uninstall    Remove ClaudeWatch, the apt source, and the signing key.
#   --yes, -y      Non-interactive mode (default when stdin is not a TTY).
#   --quiet, -q    Suppress informational output.
#   --help, -h     Show this help and exit.
#
# Environment overrides (rarely needed):
#   CLAUDEWATCH_REPO_URL   APT repo base URL (default: https://maydali28.github.io/claudewatch)
#   CLAUDEWATCH_SUITE      Repo suite              (default: stable)
#   CLAUDEWATCH_COMPONENT  Repo component          (default: main)
#
# This script is idempotent: re-running it upgrades to the latest version
# without duplicating apt sources or keyring entries. It writes config files
# atomically (temp file + mv) so a failure mid-run can't leave a broken
# /etc/apt/sources.list.d entry that would brick `apt update`.

set -euo pipefail
IFS=$'\n\t'

# ─── Constants ───────────────────────────────────────────────────────────────
readonly REPO_URL="${CLAUDEWATCH_REPO_URL:-https://maydali28.github.io/claudewatch}"
readonly SUITE="${CLAUDEWATCH_SUITE:-stable}"
readonly COMPONENT="${CLAUDEWATCH_COMPONENT:-main}"
readonly PACKAGE="claudewatch"

readonly KEYRING_DIR="/etc/apt/keyrings"
readonly KEYRING_PATH="${KEYRING_DIR}/claudewatch.gpg"
readonly SOURCE_LIST="/etc/apt/sources.list.d/claudewatch.list"

# Pinned fingerprint of the public key used to sign the apt repo. The
# installer refuses to proceed if the downloaded key does not match this
# fingerprint, so a compromised CDN or man-in-the-middle cannot substitute
# an attacker-controlled key.
#
# To rotate: generate the new key, publish its pubkey to the repo, then bump
# this constant in a new release of install.sh.
#
# Format: 40 hex chars, uppercase, no spaces.
readonly EXPECTED_FINGERPRINT="__FINGERPRINT__"

# ─── Output helpers ──────────────────────────────────────────────────────────
QUIET=0

# Use ANSI colour only when stderr is a terminal so logs stay readable when
# captured to a file (the typical case when piping into bash via curl).
if [[ -t 2 ]]; then
  readonly C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_DIM=$'\033[2m' C_RESET=$'\033[0m'
else
  readonly C_RED='' C_GREEN='' C_YELLOW='' C_DIM='' C_RESET=''
fi

log()  { (( QUIET )) || printf '%s==>%s %s\n' "$C_GREEN" "$C_RESET" "$*" >&2; }
warn() { printf '%swarning:%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ─── Argument parsing ────────────────────────────────────────────────────────
ACTION="install"
ASSUME_YES=0
[[ -t 0 ]] || ASSUME_YES=1   # piped from curl → no stdin → must be non-interactive

while (( $# > 0 )); do
  case "$1" in
    --uninstall)        ACTION="uninstall" ;;
    --yes|-y)           ASSUME_YES=1 ;;
    --quiet|-q)         QUIET=1 ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ─── Pre-flight checks ───────────────────────────────────────────────────────
require_root() {
  if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      log "re-executing under sudo"
      # Preserve relevant env so the second invocation behaves the same.
      exec sudo -E QUIET="$QUIET" ASSUME_YES="$ASSUME_YES" \
        CLAUDEWATCH_REPO_URL="$REPO_URL" \
        CLAUDEWATCH_SUITE="$SUITE" \
        CLAUDEWATCH_COMPONENT="$COMPONENT" \
        bash "$0" "$@"
    else
      die "this installer must run as root (and sudo is not available)"
    fi
  fi
}

require_supported_os() {
  [[ -r /etc/os-release ]] || die "/etc/os-release not found; this installer only supports Debian/Ubuntu"

  # shellcheck disable=SC1091
  . /etc/os-release

  case "${ID:-}:${ID_LIKE:-}" in
    debian:*|ubuntu:*|*:*debian*|*:*ubuntu*) : ;;
    *)
      die "unsupported distribution: ${PRETTY_NAME:-unknown}. ClaudeWatch APT packages target Debian/Ubuntu and derivatives."
      ;;
  esac
}

require_supported_arch() {
  local arch
  arch=$(dpkg --print-architecture 2>/dev/null || echo "unknown")
  case "$arch" in
    amd64) : ;;
    *)
      die "unsupported architecture: $arch. ClaudeWatch currently ships amd64 .deb packages only."
      ;;
  esac
}

require_tools() {
  local missing=()
  for tool in apt-get curl gpg dpkg; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if (( ${#missing[@]} > 0 )); then
    log "installing missing prerequisites: ${missing[*]}"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
  fi
}

# ─── Cleanup tracking ────────────────────────────────────────────────────────
# Files we created during this run. If anything fails before we reach the
# success path, the EXIT trap removes them so the system is left clean
# rather than half-configured (e.g. keyring written but source list missing
# would silently be a no-op; source list written but key missing would
# break apt update for everyone).
CREATED_FILES=()
INSTALL_SUCCEEDED=0

cleanup_on_failure() {
  local code=$?
  if (( INSTALL_SUCCEEDED == 0 )) && (( ${#CREATED_FILES[@]} > 0 )); then
    warn "install failed; rolling back partial changes"
    for f in "${CREATED_FILES[@]}"; do
      rm -f -- "$f"
    done
  fi
  exit "$code"
}

# ─── Install ─────────────────────────────────────────────────────────────────
do_install() {
  require_root "$@"
  require_supported_os
  require_supported_arch
  require_tools

  trap cleanup_on_failure EXIT

  install -d -m 0755 "$KEYRING_DIR"

  # Download the public key to a temp file first; only move it into place
  # once the fingerprint check passes. Using mktemp under /tmp (not in
  # /etc/apt) so a failed download never leaves debris in apt's config dir.
  local tmp_key
  tmp_key=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f -- '$tmp_key'; cleanup_on_failure" EXIT

  log "downloading signing key from ${REPO_URL}/pubkey.gpg"
  if ! curl -fsSL --retry 3 --retry-delay 2 --max-time 60 \
       -o "$tmp_key" "${REPO_URL}/pubkey.gpg"; then
    die "failed to download signing key from ${REPO_URL}/pubkey.gpg"
  fi

  # Convert to the binary format apt expects (keyring file) and verify the
  # fingerprint against EXPECTED_FINGERPRINT before trusting it.
  local tmp_keyring
  tmp_keyring=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f -- '$tmp_key' '$tmp_keyring'; cleanup_on_failure" EXIT

  gpg --dearmor < "$tmp_key" > "$tmp_keyring"

  local actual_fingerprint
  actual_fingerprint=$(gpg --no-default-keyring --keyring "$tmp_keyring" \
    --list-keys --with-colons \
    | awk -F: '/^fpr:/ { print $10; exit }')

  if [[ -z "$actual_fingerprint" ]]; then
    die "could not read fingerprint from downloaded key"
  fi

  if [[ "$EXPECTED_FINGERPRINT" == "__FINGERPRINT__" ]]; then
    # This branch runs only when the installer is published with the
    # placeholder still in place — a release-engineering bug, not a runtime
    # condition. Refuse loudly so the user does not silently trust whatever
    # key the URL serves today.
    die "this build of install.sh has no pinned fingerprint; refusing to proceed. Please report this — it is a release bug."
  fi

  if [[ "$actual_fingerprint" != "$EXPECTED_FINGERPRINT" ]]; then
    err "signing-key fingerprint mismatch"
    err "  expected: $EXPECTED_FINGERPRINT"
    err "  got:      $actual_fingerprint"
    die "refusing to install — the key served from $REPO_URL does not match the one this installer trusts"
  fi
  log "signing key verified (${actual_fingerprint})"

  # Atomic install of the keyring into apt's config directory.
  install -m 0644 "$tmp_keyring" "$KEYRING_PATH"
  CREATED_FILES+=("$KEYRING_PATH")
  rm -f -- "$tmp_key" "$tmp_keyring"
  trap cleanup_on_failure EXIT

  # Write the source list atomically. If the file already exists with the
  # same content, leave it alone (preserves mtime, avoids re-triggering
  # apt's index refresh logic unnecessarily).
  local desired_line="deb [arch=amd64 signed-by=${KEYRING_PATH}] ${REPO_URL} ${SUITE} ${COMPONENT}"
  local desired_content="# Managed by ClaudeWatch installer. See ${REPO_URL}\n${desired_line}\n"

  if [[ -f "$SOURCE_LIST" ]] && [[ "$(cat "$SOURCE_LIST")" == "$(printf '%b' "$desired_content")" ]]; then
    log "apt source already configured at ${SOURCE_LIST}"
  else
    local tmp_list
    tmp_list=$(mktemp)
    printf '%b' "$desired_content" > "$tmp_list"
    install -m 0644 "$tmp_list" "$SOURCE_LIST"
    rm -f -- "$tmp_list"
    CREATED_FILES+=("$SOURCE_LIST")
    log "wrote ${SOURCE_LIST}"
  fi

  log "refreshing apt indices"
  # Limit the refresh to our source so a failure in another (unrelated)
  # repo on this machine doesn't block the install. apt-get update with
  # -o Dir::Etc::sourcelist=… points at one source-list file only.
  apt-get update \
    -o Dir::Etc::sourcelist="sources.list.d/$(basename "$SOURCE_LIST")" \
    -o Dir::Etc::sourceparts="-" \
    -o APT::Get::List-Cleanup="0"

  log "installing ${PACKAGE}"
  local apt_yes=()
  (( ASSUME_YES )) && apt_yes=(-y)
  DEBIAN_FRONTEND=noninteractive apt-get install "${apt_yes[@]}" --no-install-recommends "$PACKAGE"

  INSTALL_SUCCEEDED=1
  trap - EXIT

  local installed_version
  installed_version=$(dpkg-query --show --showformat='${Version}' "$PACKAGE" 2>/dev/null || echo "unknown")
  log "${C_GREEN}ClaudeWatch ${installed_version} installed${C_RESET}"
  log "launch it from your applications menu, or run: ${PACKAGE}"
  log "to upgrade later: ${C_DIM}sudo apt update && sudo apt install --only-upgrade ${PACKAGE}${C_RESET}"
}

# ─── Uninstall ───────────────────────────────────────────────────────────────
do_uninstall() {
  require_root "$@"

  log "removing ${PACKAGE}"
  if dpkg-query --show "$PACKAGE" >/dev/null 2>&1; then
    local apt_yes=()
    (( ASSUME_YES )) && apt_yes=(-y)
    DEBIAN_FRONTEND=noninteractive apt-get purge "${apt_yes[@]}" "$PACKAGE" || \
      warn "apt purge failed; continuing with cleanup"
  else
    log "${PACKAGE} is not installed; cleaning up apt config only"
  fi

  if [[ -f "$SOURCE_LIST" ]]; then
    rm -f -- "$SOURCE_LIST"
    log "removed ${SOURCE_LIST}"
  fi
  if [[ -f "$KEYRING_PATH" ]]; then
    rm -f -- "$KEYRING_PATH"
    log "removed ${KEYRING_PATH}"
  fi

  apt-get update -qq || warn "apt update reported errors after cleanup (likely unrelated)"

  log "${C_GREEN}ClaudeWatch uninstalled${C_RESET}"
}

# ─── Entrypoint ──────────────────────────────────────────────────────────────
case "$ACTION" in
  install)   do_install   "$@" ;;
  uninstall) do_uninstall "$@" ;;
esac
