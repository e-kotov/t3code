#!/usr/bin/env bash
# README is the fork's landing page and the web route tree is generated; other paths use Git's
# merge, then mergiraf's syntax-aware resolution when it is installed. The fork checks gate the
# result, and the merge commit names every file mergiraf resolved.
set -euo pipefail
upstream=${1:?upstream ref required}
message=${2:?merge message required}
route_tree=apps/web/src/routeTree.gen.ts
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Commit or stash tracked changes before merging upstream.' >&2
  exit 1
fi
fork_head=$(git rev-parse HEAD)
if git merge-base --is-ancestor "$upstream" HEAD; then exit 0; fi
# diff3 markers carry the base that mergiraf needs.
git -c merge.conflictStyle=diff3 merge --no-commit --no-ff "$upstream" || true
# A failed merge with no merge state is an operational error, not a conflict.
git rev-parse -q --verify MERGE_HEAD >/dev/null || exit 1
git restore --source="$fork_head" --staged --worktree -- README.md
notes=()
if git diff --name-only --diff-filter=U | grep -qxF "$route_tree"; then
  # Upstream's tree lacks fork routes; `fork-upstream-sync.sh routes` regenerates it before the checks.
  git checkout --theirs -- "$route_tree"
  git add -- "$route_tree"
  notes+=("Took upstream's $route_tree; the sync regenerates it from the route files.")
fi
if command -v mergiraf >/dev/null; then
  solved=()
  result=$(mktemp)
  while IFS= read -r -d '' file; do
    # Files it cannot fully solve keep Git's markers, so rerere and a person see the usual conflict.
    if mergiraf solve --stdout -- "$file" >"$result" 2>/dev/null &&
      [ -s "$result" ] && ! grep -qE '^(<{7}|>{7})( |$)' "$result"; then
      cat "$result" >"$file"
      git add -- "$file"
      solved+=("$file")
    fi
  done < <(git diff --name-only --diff-filter=U -z)
  rm -f "$result"
  if [ ${#solved[@]} -gt 0 ]; then
    notes+=("Resolved by mergiraf $(mergiraf --version | awk '{print $2}'): ${solved[*]}")
  fi
fi
for note in ${notes[@]+"${notes[@]}"}; do echo "$note"; done
if [ -n "$(git diff --name-only --diff-filter=U)" ]; then exit 1; fi
args=(-m "$message")
for note in ${notes[@]+"${notes[@]}"}; do args+=(-m "$note"); done
git commit "${args[@]}"
