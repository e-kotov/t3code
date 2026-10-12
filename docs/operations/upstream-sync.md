# Upstream sync

This fork follows `pingdotgg/t3code` `main` continuously. Releases (`vX.Y.Z-ek.N`, see
[fork-release.md](fork-release.md)) are cut from fork `main` whenever a checkpoint is wanted;
they are not tied to upstream stable releases.

## Daily automation

`.github/workflows/upstream-sync.yml` runs daily at 03:17 UTC and on manual dispatch. It runs
`scripts/fork-upstream-sync.sh`:

1. `merge` merges upstream `main` into fork `main`. If upstream is already contained, it stops.
2. `checks` typechecks contracts, shared, client-runtime, server, web and mobile, then runs every
   test file the fork added or changed relative to upstream.
3. If both pass, the merge commit is pushed to `main`. Upstream workflows that became active are
   disabled; only fork-owned workflows stay enabled.

A conflict or failed check leaves `main` unchanged and fails the run. GitHub emails the
failure; the run summary lists the conflicting files. The next day's run retries automatically,
so a broken upstream commit that upstream fixes itself needs no action.

The push uses the `UPSTREAM_SYNC_TOKEN` repository secret, a fine-grained token for this
repository with **Contents** and **Workflows** read/write. `GITHUB_TOKEN` cannot push commits
that change files under `.github/workflows/`.

## Resolving a blocked sync

```sh
git fetch upstream origin
git switch main && git merge --ff-only origin/main
git merge upstream/main          # resolve conflicts; rerere replays earlier resolutions
scripts/fork-upstream-sync.sh checks
git push origin main
```

Keep fork logic in fork-owned files with small mount points in upstream files; this keeps
future conflicts small. When the fork history needs tidying (to drop or upstream a feature),
rebase it onto `upstream/main` with a backup branch `ek/pre-sync-<date>` and force-push once.

## Guards for fork development

- GitHub ruleset **Protect fork main** blocks force-pushes and deletion of `main`.
- `.vite-hooks/pre-push` runs `scripts/fork-upstream-sync.sh checks` before a push to `main`,
  refuses a push that would drop remote commits, and warns about untested code and edits to
  upstream-owned files. `FORK_SKIP_CHECKS=1` skips the checks.
- `scripts/fork-upstream-sync.sh footprint` lists upstream files the fork edits.
- Agent rules: `.agents/skills/fork-development/SKILL.md`, linked from `AGENTS.md`.
