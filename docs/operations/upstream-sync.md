# Upstream sync

This fork follows `pingdotgg/t3code` `main` continuously. Releases (`vX.Y.Z-ek.N`, see
[fork-release.md](fork-release.md)) are cut from fork `main` whenever a checkpoint is wanted;
they are not tied to upstream stable releases.

## Daily automation

`.github/workflows/upstream-sync.yml` runs daily at 03:17 UTC and on manual dispatch. It runs
`scripts/fork-upstream-sync.sh`:

1. `merge` merges upstream `main` into fork `main`. If upstream is already contained, it stops.
2. `checks` typechecks contracts, shared, client-runtime, server, web, mobile and desktop, then
   runs every test file the fork added or changed relative to upstream, plus upstream sidebar,
   markdown and editor regression tests. Web browser tests run in headless Chromium on the runner.
3. If both pass, the merge commit is pushed to `main`. Upstream workflows that became active are
   disabled; only fork-owned workflows stay enabled.

A conflict or failed check leaves `main` unchanged and fails the run. GitHub emails the
failure; the run summary lists the conflicting files. The next day's run retries automatically,
so a broken upstream commit that upstream fixes itself needs no action.

The push uses the `UPSTREAM_SYNC_TOKEN` repository secret, a fine-grained token for this
repository with **Contents** and **Workflows** read/write. `GITHUB_TOKEN` cannot push commits
that change files under `.github/workflows/`.

## Resolving a blocked sync

Egor's Mac keeps no `node_modules` (10–20 GB). Resolve the conflict with git alone and let the
workflow check it: dispatched with `branch`, it starts from that branch instead of `main`,
merges any newer upstream on top, runs the checks, fast-forwards `main` to the result and
deletes the branch. The branch must contain fork `main`.

```sh
git fetch upstream && git fetch origin
git switch main && git merge --ff-only origin/main
git merge upstream/main          # resolve conflicts; rerere replays earlier resolutions
VP_GIT_HOOKS=0 git commit --no-edit   # the upstream pre-commit hook needs vp
git push origin HEAD:refs/heads/sync/upstream-$(date +%F)
gh workflow run upstream-sync.yml -R e-kotov/t3code -f branch=sync/upstream-$(date +%F)
```

When the run is green, `git pull` on `main`. The same path checks any other fork commit made
without local dependencies. `VP_GIT_HOOKS=0` also skips `vp fmt`, and the checks do not run
the formatter, so keep resolutions in the surrounding style.

Keep fork logic in fork-owned files with small mount points in upstream files; this keeps
future conflicts small. When the fork history needs tidying (to drop or upstream a feature),
rebase it onto `upstream/main` with a backup branch `ek/pre-sync-<date>` and force-push once.

## Guards for fork development

- GitHub ruleset **Protect fork main** blocks force-pushes and deletion of `main`.
- `.vite-hooks/pre-push` runs `scripts/fork-upstream-sync.sh checks` before a push to `main`,
  refuses a push that would drop remote commits, and warns about untested code and edits to
  upstream-owned files. `FORK_SKIP_CHECKS=1` skips the checks. Without local dependencies it
  refuses the push and points to the branch path above.
- `scripts/fork-upstream-sync.sh footprint` lists upstream files the fork edits.
- Agent rules: `.agents/skills/fork-development/SKILL.md`, linked from `AGENTS.md`.
