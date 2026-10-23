#!/usr/bin/env bash
# README is the fork's landing page. All other paths use Git's normal merge rules.
set -euo pipefail
upstream=${1:?upstream ref required}
message=${2:?merge message required}
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Commit or stash tracked changes before merging upstream.' >&2
  exit 1
fi
fork_head=$(git rev-parse HEAD)
if git merge-base --is-ancestor "$upstream" HEAD; then exit 0; fi
git merge --no-commit --no-ff "$upstream" || true
# A failed merge with no merge state is an operational error, not a conflict.
git rev-parse -q --verify MERGE_HEAD >/dev/null || exit 1
git restore --source="$fork_head" --staged --worktree -- README.md
if [ -n "$(git diff --name-only --diff-filter=U)" ]; then exit 1; fi
git commit -m "$message"
