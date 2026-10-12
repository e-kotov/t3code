#!/usr/bin/env bash
# Daily fork maintenance for .github/workflows/upstream-sync.yml.
#   merge      merge pingdotgg/t3code main into the fork's main (fails on conflict)
#   checks     typecheck the packages the fork changes and run every test file it touched
#   footprint  list upstream-owned files the fork edits, with changed line counts
set -euo pipefail

UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/pingdotgg/t3code.git}
out() { echo "$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }
summary() { echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"; }

case "${1:?usage: fork-upstream-sync.sh merge|checks|footprint}" in
  merge)
    git fetch --no-tags origin main:refs/remotes/origin/main
    git fetch --no-tags "$UPSTREAM_URL" main:refs/remotes/upstream/main
    git checkout -B main refs/remotes/origin/main
    upstream=$(git rev-parse refs/remotes/upstream/main)
    out "upstream=$upstream"
    if git merge-base --is-ancestor "$upstream" HEAD; then
      summary "Fork main already contains upstream ${upstream:0:10}."
      out "changed=false"
      exit 0
    fi
    behind=$(git rev-list --count HEAD.."$upstream")
    if ! git merge --no-edit -m "Merge upstream main ${upstream:0:10}" "$upstream"; then
      summary "## Upstream sync blocked by conflicts"
      summary ""
      summary "Upstream ${upstream:0:10} ($behind new commits) does not merge cleanly. Fork main was not changed."
      summary "Resolve locally: \`git fetch upstream && git merge upstream/main\`, then push main."
      summary ""
      git diff --name-only --diff-filter=U | sed 's/^/- `/; s/$/`/' >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"
      git merge --abort
      exit 1
    fi
    summary "Merged $behind upstream commits up to ${upstream:0:10}."
    out "changed=true"
    ;;
  checks)
    upstream=${UPSTREAM_SHA:-$(git rev-parse upstream/main)}
    RUNNER_TEMP=${RUNNER_TEMP:-$(mktemp -d)}
    # Git hooks put a relative node_modules/.bin on PATH, which breaks after cd into a package.
    PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH"
    vp run --concurrency-limit 2 \
      --filter @t3tools/contracts --filter @t3tools/shared --filter @t3tools/client-runtime \
      --filter t3 --filter @t3tools/web --filter @t3tools/mobile typecheck
    # Tests the fork added or changed, run from each package so its own Vitest config applies.
    git diff --name-only --diff-filter=AM "$upstream" HEAD -- '*.test.ts' '*.test.tsx' |
      awk -F/ '($1 == "apps" || $1 == "packages") && NF > 2 { print $1 "/" $2 " " substr($0, length($1 "/" $2) + 2) }' |
      sort > "$RUNNER_TEMP/fork-tests.txt"
    status=0
    for package in $(cut -d' ' -f1 "$RUNNER_TEMP/fork-tests.txt" | uniq); do
      tests=()
      while read -r test; do tests+=("$test"); done < <(awk -v p="$package" '$1 == p { print $2 }' "$RUNNER_TEMP/fork-tests.txt")
      echo "::group::$package tests (${#tests[@]} files)"
      (cd "$package" && vp test run "${tests[@]}") || status=1
      echo "::endgroup::"
    done
    [ "$status" -eq 0 ] || summary "Fork tests failed after merging upstream; main was not changed."
    exit "$status"
    ;;
  footprint)
    # Fork edits inside upstream files are where merge conflicts come from; keep this list short.
    upstream=${UPSTREAM_SHA:-$(git rev-parse upstream/main)}
    git diff --numstat --diff-filter=M "$upstream" HEAD |
      awk '{ printf "%6d  %s\n", $1 + $2, $3; total += $1 + $2 } END { printf "%6d  total lines in %d upstream files\n", total, NR }' |
      sort -rn
    ;;
  *) echo "unknown command: $1" >&2; exit 2 ;;
esac
