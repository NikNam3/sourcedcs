#!/usr/bin/env bash
# Snapshot every lane worktree's working tree (tracked + untracked, minus ignored)
# into refs/checkpoints/<branch> without touching its index, HEAD or files.
# Restore a lost lane with:  git checkout refs/checkpoints/lane/<name> -- .
set -u
ROOT=/home/nklx/dev/personal/sourcedcs
git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
  [ "$wt" = "$ROOT" ] && continue
  br=$(git -C "$wt" symbolic-ref --quiet --short HEAD) || continue
  tmpidx=$(mktemp)
  if GIT_INDEX_FILE="$tmpidx" git -C "$wt" read-tree HEAD 2>/dev/null &&
     GIT_INDEX_FILE="$tmpidx" git -C "$wt" add -A 2>/dev/null; then
    tree=$(GIT_INDEX_FILE="$tmpidx" git -C "$wt" write-tree)
    prev=$(git -C "$wt" rev-parse -q --verify "refs/checkpoints/$br^{tree}" 2>/dev/null || true)
    if [ "$tree" != "$prev" ]; then
      c=$(git -C "$wt" commit-tree "$tree" -p HEAD -m "checkpoint $br $(date -Is)")
      git -C "$wt" update-ref "refs/checkpoints/$br" "$c"
      echo "$(date -Is) $br -> ${c:0:8}"
    fi
  fi
  rm -f "$tmpidx"
done
