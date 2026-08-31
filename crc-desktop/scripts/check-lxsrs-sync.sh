#!/usr/bin/env bash
# CI/pre-flight check: fails if crc-desktop/python-pkg/lxsrs_v2 has drifted
# from lxsrs_v2/lxsrs_v2. Re-vendors into a scratch dir (never touches the
# committed python-pkg/) and diffs the two. See sync-lxsrs.sh for how to fix
# a reported drift.
#
# Usage: crc-desktop/scripts/check-lxsrs-sync.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LXSRS_SRC="$REPO_ROOT/lxsrs_v2"
VENDORED="$REPO_ROOT/crc-desktop/python-pkg/lxsrs_v2"

if command -v pip3 >/dev/null 2>&1; then
  PIP=(pip3)
else
  PIP=(python3 -m pip)
fi

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

"${PIP[@]}" install --no-deps --target="$SCRATCH" "$LXSRS_SRC" --no-input --quiet
find "$SCRATCH" -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
find "$VENDORED" -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true

if diff -rq "$VENDORED" "$SCRATCH/lxsrs_v2" >/dev/null 2>&1; then
  echo "OK: crc-desktop/python-pkg/lxsrs_v2 matches lxsrs_v2/lxsrs_v2."
  exit 0
else
  echo "DRIFT DETECTED: crc-desktop/python-pkg/lxsrs_v2 does not match lxsrs_v2/lxsrs_v2." >&2
  echo "" >&2
  diff -rq "$VENDORED" "$SCRATCH/lxsrs_v2" >&2 || true
  echo "" >&2
  echo "Run crc-desktop/scripts/sync-lxsrs.sh and commit the result." >&2
  exit 1
fi
