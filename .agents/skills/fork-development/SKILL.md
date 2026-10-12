---
name: fork-development
description: Rules for changing source in e-kotov/t3code, a fork that merges pingdotgg/t3code main daily. Use before adding or changing any fork feature, committing, pushing main, or resolving an upstream-sync conflict.
---

# Developing in the T3 Code fork

This checkout is Egor Kotov's fork. Upstream will not merge fork features, and
`.github/workflows/upstream-sync.yml` merges upstream `main` into fork `main` every day
(runbook: `docs/operations/upstream-sync.md`). Every rule below keeps that merge clean.

## Before changing code

- Run `git pull` so you start from the latest bot merge. The checkout rebases local commits
  and autostashes uncommitted edits.
- Do not discard or commit someone else's uncommitted work without asking.

## Where fork code goes

- Put feature logic in new, fork-owned files (components, hooks, services, tests).
- Change upstream-owned files only to mount that code: an import plus a line or two. Do not
  restructure, reformat or rename upstream code.
- Run `scripts/fork-upstream-sync.sh footprint` before and after. It lists upstream files the
  fork edits; your change should not grow it beyond the mount lines. If a feature needs a
  large edit inside an upstream file, extract the fork part into a new file first.

## Tests

- Add or extend a test file for every behavior you add or change. The daily sync runs every
  test file the fork adds or changes, so tests are what protect a feature from later upstream
  changes; a clean merge without tests can still break it silently.
- When an upstream test fails because of a fork change, fix the fork code so the upstream
  behavior holds when the fork option is not selected. Do not edit upstream tests to pass.

## Committing and pushing

- Commit fork work to `main` in focused commits. Never force-push `main`: it would drop the
  bot's merges. A GitHub ruleset and the `.vite-hooks/pre-push` guard both block it.
- The pre-push guard runs `scripts/fork-upstream-sync.sh checks` (about 20 s warm) and warns
  about untested code or edits to upstream files. Fix failures; do not bypass with
  `FORK_SKIP_CHECKS=1` unless Egor asks.
- Releases are tags `vX.Y.Z-ek.N` (`docs/operations/fork-release.md`). A release needs the GWDG
  server, Mac app and Android APK upgraded together.

## Resolving a blocked upstream sync

When the daily run fails with conflicts, merge locally (`git fetch upstream && git merge
upstream/main`), keep both sides' intent, run `checks`, and push. `rerere` is enabled, so
resolutions are reused. A history-tidying rebase is a deliberate exception: make a backup
branch `ek/pre-sync-<date>`, disable the `main` ruleset, push with
`FORK_ALLOW_MAIN_REWRITE=1`, then re-enable the ruleset.
