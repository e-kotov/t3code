#!/usr/bin/env bash
# Daily fork maintenance for .github/workflows/upstream-sync.yml.
#   merge      merge pingdotgg/t3code main into the fork's main (fails on conflict)
#   checks     typecheck the packages the fork changes and run every test file it touched
#   footprint [REV]  list upstream-owned files the fork edits, with changed line counts;
#                    measures the working tree by default, or REV (e.g. HEAD) if given
# checks and footprint compare against UPSTREAM_SHA, else the upstream commit HEAD contains,
# so a fetched but unmerged upstream/main does not count its own changes as fork edits.
set -euo pipefail

UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/pingdotgg/t3code.git}
out() { echo "$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }
summary() { echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"; }
fork_base() { [ -n "${UPSTREAM_SHA:-}" ] && echo "$UPSTREAM_SHA" || git merge-base HEAD refs/remotes/upstream/main; }

cmd=${1:?usage: fork-upstream-sync.sh merge|checks|footprint [REV]}
shift
case "$cmd" in
  merge)
    git fetch --no-tags origin main:refs/remotes/origin/main
    git fetch --no-tags "$UPSTREAM_URL" main:refs/remotes/upstream/main
    start=refs/remotes/origin/main
    if [ -n "${SYNC_BRANCH:-}" ]; then
      # A branch pushed without local checks (e.g. a hand-resolved conflict); main moves to it if it passes.
      git fetch --no-tags origin "refs/heads/$SYNC_BRANCH:refs/fork-sync/branch"
      if ! git merge-base --is-ancestor refs/remotes/origin/main refs/fork-sync/branch; then
        summary "Branch \`$SYNC_BRANCH\` does not contain fork main; merge origin/main into it first."
        exit 1
      fi
      start=refs/fork-sync/branch
      summary "Checking branch \`$SYNC_BRANCH\` ($(git rev-parse --short "$start"))."
    fi
    git checkout -B main "$start"
    upstream=$(git rev-parse refs/remotes/upstream/main)
    if [ "${SYNC_PROMOTE_ONLY:-false}" = true ]; then
      [ -n "${SYNC_BRANCH:-}" ] || { summary 'Promotion requires an explicit branch.'; exit 1; }
      # Compare the fork against the upstream base it actually contains. A client
      # release must not silently pull in unrelated upstream protocol changes.
      upstream=$(git merge-base HEAD refs/remotes/upstream/main)
      out "upstream=$upstream"
      summary "Checking the selected branch without merging newer upstream code."
      [ "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/main)" ] && out "changed=false" || out "changed=true"
      exit 0
    fi
    out "upstream=$upstream"
    if git merge-base --is-ancestor "$upstream" HEAD; then
      summary "Fork main already contains upstream ${upstream:0:10}."
      [ "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/main)" ] && out "changed=false" || out "changed=true"
      exit 0
    fi
    behind=$(git rev-list --count HEAD.."$upstream")
    if ! bash scripts/fork-merge-upstream.sh "$upstream" "Merge upstream main ${upstream:0:10}"; then
      summary "## Upstream sync blocked by conflicts"
      summary ""
      summary "Upstream ${upstream:0:10} ($behind new commits) does not merge cleanly. Fork main was not changed."
      summary "Resolve it on a branch and let this workflow check it: see docs/operations/upstream-sync.md."
      summary ""
      git diff --name-only --diff-filter=U | sed 's/^/- `/; s/$/`/' >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"
      git merge --abort
      exit 1
    fi
    summary "Merged $behind upstream commits up to ${upstream:0:10}."
    out "changed=true"
    ;;
  checks)
    upstream=$(fork_base)
    python3 scripts/fork-merge-upstream.test.py
    python3 scripts/fork-footprint-budget.test.py
    python3 scripts/fork-nightly-release.test.py
    python3 scripts/build-termux-server.test.py
    UPSTREAM_SHA="$upstream" python3 scripts/fork-footprint-budget.py
    RUNNER_TEMP=${RUNNER_TEMP:-$(mktemp -d)}
    # Git hooks put a relative node_modules/.bin on PATH, which breaks after cd into a package.
    PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH"
    status=0
    if [ -n "${FORK_CHANGED_CHECKS_BASE:-}" ]; then
      vp run check:changed "$FORK_CHANGED_CHECKS_BASE" || status=1
    fi
    for package in packages/contracts packages/shared packages/client-runtime packages/ssh apps/server apps/web apps/mobile apps/desktop; do
      echo "::group::$package typecheck"
      (cd "$package" && vp run typecheck) || status=1
      echo "::endgroup::"
    done
    # Tests the fork added or changed, run from each package so its own Vitest config applies.
    git diff --name-only --diff-filter=AM "$upstream" HEAD -- '*.test.ts' '*.test.tsx' |
      awk -F/ '($1 == "apps" || $1 == "packages") && NF > 2 { print $1 "/" $2 " " substr($0, length($1 "/" $2) + 2) } $1 == "scripts" { print "scripts " substr($0, 9) }' |
      sort > "$RUNNER_TEMP/fork-tests.txt"
    # Upstream tests beside upstream files the fork mounts into keep upstream defaults intact.
    # reactCompilerCoverage compiles every mobile source file, fork files included.
    cat >> "$RUNNER_TEMP/fork-tests.txt" <<'TESTS'
apps/desktop src/electron/ElectronShell.test.ts
apps/mobile src/reactCompilerCoverage.test.ts
apps/mobile src/features/settings/SettingsRouteScreen.logic.test.ts
apps/mobile src/features/threads/threadListV2.test.ts
apps/mobile src/features/workspace/workspace-tabs-state.test.ts
apps/server src/orchestration-v2/IdleCompaction.test.ts
apps/server src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts
apps/server src/process/externalLauncher.test.ts
apps/server src/ws.test.ts
apps/web src/components/chat/OpenInPicker.browser.test.tsx
apps/web src/components/ChatMarkdown.browser.test.tsx
apps/web src/components/ChatMarkdown.permissions.browser.test.tsx
apps/web src/hooks/useThreadActionMenu.test.ts
apps/web src/components/threadActionMenu.logic.test.ts
apps/web src/components/Sidebar.logic.test.ts
apps/web src/components/Sidebar.drag.test.ts
apps/web src/components/Sidebar.pointer.browser.test.tsx
apps/web src/editorPreferences.test.ts
packages/client-runtime src/rpc/session.test.ts
packages/client-runtime src/state/customSnooze.test.ts
packages/client-runtime src/state/threadSort.test.ts
packages/ssh src/tunnel.test.ts
packages/shared src/serverSettings.test.ts
packages/shared src/composerInlineTokens.test.ts
TESTS
    while read -r package test; do
      [ -f "$package/$test" ] || { echo "Missing selected test: $package/$test" >&2; exit 1; }
    done < "$RUNNER_TEMP/fork-tests.txt"
    sort -u -o "$RUNNER_TEMP/fork-tests.txt" "$RUNNER_TEMP/fork-tests.txt"
    for package in $(cut -d' ' -f1 "$RUNNER_TEMP/fork-tests.txt" | uniq); do
      tests=()
      while read -r test; do tests+=("$test"); done < <(awk -v p="$package" '$1 == p { print $2 }' "$RUNNER_TEMP/fork-tests.txt")
      echo "::group::$package tests (${#tests[@]} files)"
      (cd "$package" && vp test run "${tests[@]}") || status=1
      echo "::endgroup::"
    done
    [ "$status" -eq 0 ] || summary "Fork validation failed after merging upstream; main was not changed."
    exit "$status"
    ;;
  footprint)
    # Fork edits inside upstream files are where merge conflicts come from; keep this list short.
    upstream=$(fork_base)
    git diff --numstat --diff-filter=MD "$upstream" "$@" -- . ':!README.md' |
      awk '{ printf "%6d  %s\n", $1 + $2, $3; total += $1 + $2 } END { printf "%6d  total lines in %d upstream files\n", total, NR }' |
      sort -rn
    ;;
  *) echo "unknown command: $1" >&2; exit 2 ;;
esac
