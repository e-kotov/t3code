---
name: fork-development
description: Rules for changing source in e-kotov/t3code, a fork that merges pingdotgg/t3code main every six hours. Use before adding or changing any fork feature, committing, opening a pull request, or resolving an upstream-sync conflict.
---

# Developing in the T3 Code fork

This checkout is Egor Kotov's fork. Upstream will not merge fork features, and
`.github/workflows/upstream-sync.yml` merges upstream `main` into fork `main` every six hours
(runbook: `docs/operations/upstream-sync.md`). Every rule below keeps that merge clean.

## Before changing code

- Inspect the current branch and worktree, then `git fetch origin`. Start new work on a named
  feature branch from `origin/main`; continue existing work on its own branch. Never develop
  or commit directly on local `main`.
- Do not discard or commit someone else's uncommitted work without asking.

## Where fork code goes

- Put feature logic in new, fork-owned files (components, hooks, services, tests).
- Change upstream-owned files only to mount that code: an import plus a line or two. Do not
  restructure, reformat or rename upstream code.
- CI and the pre-push checks enforce `scripts/fork-footprint-budget.json` per upstream-owned file. New upstream-file edits have zero budget; extract fork logic first. An unavoidable mount change needs an explicit, reviewed budget update via `python3 scripts/fork-footprint-budget.py --write` after committing. A budgeted upstream file whose fork diff drops to 0 lines fails the check as a dropped mount until it is restored, or the retirement is reviewed and committed via `--write`; a partial shrink only warns. Never auto-refresh it in CI.
- Run `scripts/fork-upstream-sync.sh footprint` before and after. It lists upstream files the
  fork edits; your change should not grow it beyond the mount lines. If a feature needs a
  large edit inside an upstream file, extract the fork part into a new file first.

- Reducing automatic upstream merge conflicts is a requirement for every fork change. Reuse
  upstream APIs and components through small adapters; do not copy their private internals.
- Keep fork installation, platform support and signing guidance in `docs/user/fork-install.md`.
  The README is a short fork-owned entry point; link to the upstream README rather than
  maintaining or rewriting a second copy of upstream's installation instructions.
- Share fork behavior across clients when practical, with platform storage and UI adapters.
  Keep fork imports alongside the relevant integration rather than repeatedly editing the
  beginning of an upstream import block.

## Tests

- Add or extend a test file for every behavior you add or change. The daily sync runs every
  test file the fork adds or changes, so tests are what protect a feature from later upstream
  changes; a clean merge without tests can still break it silently.
- When an upstream test fails because of a fork change, fix the fork code so the upstream
  behavior holds when the fork option is not selected. Do not edit upstream tests to pass.

## Branches and pull requests

- Submit every agent-authored change through a feature branch and a pull request targeting
  `main` in **`e-kotov/t3code`**, including tiny fixes, documentation and manually resolved
  upstream merges. Do not target `pingdotgg/t3code` unless Egor explicitly requests it.
- Never push agent work directly to `main` or manually dispatch `upstream-sync.yml` to
  promote a work branch without its PR. Passing checks does not replace the PR. Existing
  scheduled upstream-sync automation is documented separately in the operations runbook.
- Push the feature branch, open the fork PR and link it to the T3 thread. Merge only within
  the user's authorized endpoint and after required checks/reviews pass. Never force-push
  `main`, disable branch protection, or use a history rewrite to bypass this route.
- Keep Greptile review enabled by default. For a **very minor change** (for example, a typo
  or narrow documentation correction), or when Egor explicitly asks to skip Greptile,
  apply the **`skip-greptile` PR label when creating the PR**. The repository's
  `greptile.json` lists it in `disabledLabels`; a title tag or Git tag is not the control.
  Do not skip merely because a substantial change has few lines. Skipping Greptile does
  not skip CI or a requested independent review.
- Egor's Mac keeps no dependencies: do not run `vp install`/`pnpm install` there (10–20 GB).
  Commit on the feature branch with `VP_GIT_HOOKS=0`, since the upstream pre-commit hook
  needs `vp`; this does not authorize a direct main push or bypass CI. Let the fork PR's
  GitHub checks validate the change. Never build Android on the Mac (no Gradle,
  `expo prebuild` or `expo run:android`); APKs come from the release workflow.

## Releases

Checkpoint releases are made when Egor asks. Automatic nightly prereleases are authorized
for changed, validated main through `nightly-fork.yml`; the driver skips published commits.
Procedure: `docs/operations/fork-release.md`.

- Tag `vX.Y.Z-ek.N`, annotated, on a commit already on `main`, pushed with
  `git push origin <tag>`. `X.Y.Z` is the version of upstream's newest nightly merged into
  `main` (`git tag --merged origin/main --sort=-v:refname --list 'v*-nightly.*' | head -1`).
  `N` is UTC `YYYYMMDD` followed by a four-digit daily counter (`0001`–`9999`),
  e.g. `202610260001`. Allocate it with `scripts/fork-nightly-release.py`; do not increment
  the legacy short counter. This keeps GitHub's alphabetical prerelease sorting and numeric
  updaters in agreement. Never reuse or move a tag, even for a failed build.
- For a checkpoint, push the tag and dispatch `release-fork.yml` on main with its version and
  `publish=true`; a tag push alone does not build. The nightly driver does this automatically
  after validation, passing the exact checked commit. Every build must pass before publication.
  Releases remain GitHub prereleases, then the `homebrew_tap` job moves
  the `e-kotov/tap` cask `t3-code-ek` to it. Edit the cask by hand only if that job failed;
  copy the DMG checksums from the release's `SHA256SUMS`.
- Never install or upgrade T3 Code on Egor's Mac (`brew upgrade`, replacing the app): agent
  sessions often run inside it. Egor installs the Mac app and the Android APK.
- The GWDG server is upgraded only when Egor says so, by changing its version pin in GWDG
  chezmoi on GWDG. Say whether a release changed server code; client-only changes do not
  need the server upgraded, except for browser access served by GWDG.

## Checking UI locally

Egor's Mac runs the real T3 app, often with this session inside it. A check must not touch it.

A local UI check needs dependencies, so ask Egor first; delete `node_modules` and the pnpm
store afterwards.

- Use an isolated dev copy: `node scripts/dev-runner.ts dev --home-dir /tmp/<name>` with
  `node_modules/.bin` on `PATH`, driven by headless Playwright. Never use Egor's T3 data.
- Never start anything that opens a window or browser tab on the Mac. An extra server must
  be headless (`t3 serve`, never `start`). Do not build multi-machine setups for a visual
  check: verify such layouts with tests and say they were not seen.
- Real provider turns spend Egor's subscription: send at most one short prompt and report it.
- When done, stop everything: the dev runner, the server it restarts on file changes (its
  environment has `T3CODE_HOME=/tmp/<name>`) and the web server; confirm ports 5733 and
  13773 are free.

## Resolving a blocked upstream sync

When the daily run fails with conflicts, merge locally (`git fetch upstream`, then `bash scripts/fork-merge-upstream.sh upstream/main "Merge upstream main"`) and keep both sides' intent; `rerere` is enabled, so resolutions are reused. The helper takes upstream's generated `routeTree.gen.ts` (the workflow regenerates it) and, when `mergiraf` is installed, tries it on the remaining files. What is left needs judgment: an upstream refactor of the code a fork mount touches. Check auto-merged fork mounts too: a clean merge can still drop a fork entry from a list upstream restructured.
Do not install dependencies for this: Egor keeps no `node_modules` on the Mac. Resolve the
merge on a `sync/<name>` branch created from `origin/main`, commit with `VP_GIT_HOOKS=0`,
push that branch and open a PR to `e-kotov/t3code` main. Follow the same review/skip-label
rules as other agent work. Do not manually promote the branch with `upstream-sync.yml`,
force-push main or disable its protection (runbook: `docs/operations/upstream-sync.md`).
