#!/usr/bin/env bash
# Re-vendors lxsrs_v2 into crc-desktop/python-pkg.
#
# crc-desktop bundles its own copy of lxsrs_v2 (python-pkg/lxsrs_v2/) rather
# than depending on the top-level lxsrs_v2/ package at runtime, because the
# packaged app ships via electron-builder's extraResources (see README.md),
# not a Python package manager on the end user's machine. That means a
# bugfix to lxsrs_v2/lxsrs_v2/*.py does NOT reach crc-desktop until this
# vendored copy is regenerated and committed. There is no CI check for this
# (see check-lxsrs-sync.sh) — running this script and committing the result
# after every lxsrs_v2 change is currently a manual step.
#
# Usage: crc-desktop/scripts/sync-lxsrs.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LXSRS_SRC="$REPO_ROOT/lxsrs_v2"
VENDOR_DIR="$REPO_ROOT/crc-desktop/python-pkg"

if [ ! -f "$LXSRS_SRC/pyproject.toml" ]; then
  echo "error: $LXSRS_SRC does not look like the lxsrs_v2 package (no pyproject.toml)" >&2
  exit 1
fi

# Some Python installs (e.g. this repo's nix devShell) don't bundle a pip
# module even though a separate `pip3` binary exists on PATH — prefer that,
# fall back to `python3 -m pip`.
if command -v pip3 >/dev/null 2>&1; then
  PIP=(pip3)
else
  PIP=(python3 -m pip)
fi

echo "Re-vendoring lxsrs_v2 into $VENDOR_DIR ..."

# --no-deps: crc-desktop's Electron-side venv (see lxsrs-setup.js's
# LXSRS_VENV_DEPS) installs lxsrs_v2's third-party deps at first run on the
# end user's machine — this vendored copy must contain ONLY lxsrs_v2's own
# source, not numpy/sounddevice/opuslib themselves.
"${PIP[@]}" install --no-deps --target="$VENDOR_DIR" "$LXSRS_SRC" --force-reinstall --no-input

# pip's --target install leaves __pycache__ dirs and a RECORD file with
# absolute build-machine paths baked in — neither is meant to be committed.
find "$VENDOR_DIR" -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true

if git -C "$REPO_ROOT" diff --quiet -- "$VENDOR_DIR" && \
   git -C "$REPO_ROOT" diff --cached --quiet -- "$VENDOR_DIR" && \
   [ -z "$(git -C "$REPO_ROOT" ls-files --others --exclude-standard "$VENDOR_DIR")" ]; then
  echo "No changes — crc-desktop/python-pkg/lxsrs_v2 already matches lxsrs_v2/lxsrs_v2."
else
  echo ""
  echo "crc-desktop/python-pkg changed. Review with:"
  echo "  git -C '$REPO_ROOT' status -- '$VENDOR_DIR'"
  echo "  git -C '$REPO_ROOT' diff -- '$VENDOR_DIR'"
  echo "then commit the update alongside your lxsrs_v2 change."
fi
