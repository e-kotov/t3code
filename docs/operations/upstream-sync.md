# Upstream sync

This fork follows `pingdotgg/t3code` `main` continuously. Releases (`vX.Y.Z-ek.N`, see
[fork-release.md](fork-release.md)) are cut from fork `main` whenever a checkpoint is wanted;
they are not tied to upstream stable releases.

## Daily automation

`.github/workflows/upstream-sync.yml` runs at 03:17, 09:17, 15:17 and 21:17 UTC and on manual dispatch. It runs
`scripts/fork-upstream-sync.sh`:

1. `merge` merges upstream `main` into fork `main`. If upstream is already contained, it stops.
   `fork-merge-upstream.sh` preserves the fork-owned README, including when upstream edits
   would otherwise merge cleanly; upstream documentation remains linked from the fork landing
   page. A conflicted `apps/web/src/routeTree.gen.ts` takes upstream's version. Other conflicts
   go to [mergiraf](https://mergiraf.org) (pinned in the workflow), a syntax-aware merge driver
   that resolves, for example, both sides adding imports or list entries at the same place.
   It replaces a file only when it resolves every conflict in it; anything else keeps Git's
   markers and blocks the sync. The merge commit message and run summary name each file
   mergiraf resolved. Its results are not reviewed by a person: the checks below decide.
   Replaying the 2026-10-27 sync, it resolved 7 of 15 files, one of them wrongly (a duplicate
   import that the typecheck rejects).
2. `tidy` formats the files mergiraf resolved, which it leaves unformatted, and commits the route
   tree that `scripts/fork-route-tree.mjs` regenerated with the web build's TanStack generator, so
   the fork's route files are listed again.
3. `checks` first rejects any growth beyond the reviewed per-file upstream-edit budget or any budgeted fork mount dropped to 0 lines, then typechecks contracts, shared, client-runtime, SSH, server, web, mobile and desktop, then
   runs every test file the fork added or changed relative to upstream, plus the upstream tests
   beside upstream files the fork mounts into (listed in the script) and the mobile React
   Compiler coverage test. Web browser tests run in headless Chromium on the runner.
4. If the checks pass, the merge commit is pushed to `main`. Upstream workflows that became active are
   disabled; only fork-owned workflows stay enabled.

## Conflicts and failed checks: Claude

When a sync started from `main` still has conflicts after mergiraf, the merge step commits the
conflicted merge, markers included. When it merged cleanly but a check failed, its merge is kept
as it is. Either way the run uploads it as `upstream-handoff`, and
`.github/workflows/claude-sync.yml` resolves it with Claude Code (pinned version) and the Claude
Platform key `ANTHROPIC_API_KEY`, in a workspace with a monthly spend limit:

1. **Fix**: Claude Opus at high effort (`--effort high`) gets
   [`.github/claude/fix-upstream-sync.md`](../../.github/claude/fix-upstream-sync.md) plus the
   conflicted files or an excerpt of the failed checks' error lines
   (`scripts/fork-sync-excerpt.py`). Vite+ is bootstrapped from clean fork-main manifests and
   Claude is installed outside the candidate, so conflicted package files cannot prevent it
   starting. An initial dependency install may fail; its error goes into Claude's context.
   Claude resolves manifests and the lockfile, installs dependencies, then typechecks and tests
   what it touches. It may edit files and run `git` read commands, `vp` and the budget script;
   it has no network tools and no push credentials.
2. **Review**: a second, read-only Claude run reviews only that fix
   ([`.github/claude/review-upstream-sync.md`](../../.github/claude/review-upstream-sync.md)) and
   returns a structured verdict.
3. **Follow-up fix**, once: for the review's findings, or, if the review approved, for a failed
   check of the resolution.
4. A mandatory `vp install --frozen-lockfile` must pass after the fix/review cycle. Initial
   installation failure never bypasses this gate. A requested product decision still stops the run.
5. The workflow rebuilds one merge commit with the original parents (fork `main`, upstream), pushes
   it as `sync/claude-<UTC time>` from a job that runs no repository code, and dispatches this
   workflow with `promote_only`. The usual checks decide promotion; the branch is deleted after
   it. If they fail after the follow-up is used, or Claude writes `.claude-needs-decision.md`, the
   run fails (GitHub emails it) and the branch stays for Egor. Decision requests also appear in
   the job log and the downloadable `claude-decision` artifact, so `gh run view --log-failed` or
   `gh run download -n claude-decision` can retrieve them without a browser login. While a
   `sync/claude-*` branch exists, no new resolution starts; delete it to re-enable automatic resolution.

Each Claude run has a spend cap (`--max-budget-usd`: fix 10, review 4, follow-up 8 US dollars), so
one sync costs at most about 22 dollars of Platform credits and usually far less. The job that runs
Claude also installs and runs repository code with the API key in its environment; the workspace
spend limit bounds what a compromised dependency could do with it.

Workflow changes run `scripts/claude-sync.test.py` without a model call. The regression executes
actual workflow shell steps with a failed installer and checks that Claude still runs, an
unrepaired lockfile still blocks validation, and bootstrap uses clean manifests. To exercise
one real repair of a deliberately inconsistent patch hash on a tiny local dependency, dispatch
`claude-sync.yml` with `live_smoke=true`. This uses the configured Claude model, caps the call
at 2 USD, verifies a real frozen install and the retained patch, and never promotes a branch.

A conflict or failed check leaves `main` unchanged and fails the run. GitHub emails the
failure; the run summary lists the conflicting files. The next scheduled run retries automatically,
so a broken upstream commit that upstream fixes itself needs no action.

The push uses the `UPSTREAM_SYNC_TOKEN` repository secret, a fine-grained token for this
repository with **Actions**, **Contents** and **Workflows** read/write. `GITHUB_TOKEN` cannot push
commits that change files under `.github/workflows/`. Claude sync also dispatches its check with
this token: checks it dispatched with `GITHUB_TOKEN` completed without firing `workflow_run`, so a
failed `sync/claude-*` check never reached Claude sync.

## Resolving a blocked sync

Egor's Mac keeps no `node_modules` (10–20 GB). Resolve the conflict with git alone and let the
workflow check it: dispatched with `branch`, it starts from that branch instead of `main`,
merges any newer upstream on top, runs the checks, fast-forwards `main` to the result and
deletes the branch. The branch must contain fork `main`.

```sh
git fetch upstream && git fetch origin
git switch main && git merge --ff-only origin/main
bash scripts/fork-merge-upstream.sh upstream/main "Merge upstream main"
# rerere replays earlier resolutions; with `brew install mergiraf` the helper also tries it.
# Resolve what remains. Take upstream's routeTree.gen.ts; the workflow regenerates it.
VP_GIT_HOOKS=0 git commit --no-edit   # the upstream pre-commit hook needs vp
git push origin HEAD:refs/heads/sync/upstream-$(date +%F)
gh workflow run upstream-sync.yml -R e-kotov/t3code -f branch=sync/upstream-$(date +%F)
```

When the run is green, `git pull` on `main`. The same path checks any other fork commit made
without local dependencies. `VP_GIT_HOOKS=0` skips local formatting; GitHub checks the
committed files with the repository formatter.

Changed syncs also run `vp run check:changed` against
`origin/main`, including formatting, lint, knip, affected-package typechecks and adjacent
tests. All changed syncs check formatting before browser setup. Failed changed syncs upload a
`fork-format-fixes` patch artifact when the formatter is available; apply any needed changes
locally, review the diff and rerun.
The runner never promotes uncommitted formatter changes.

Keep fork logic in fork-owned files with small mount points in upstream files; this keeps
future conflicts small. When the fork history needs tidying (to drop or upstream a feature),
rebase it onto `upstream/main` with a backup branch `ek/pre-sync-<date>` and force-push once.

## Guards for fork development

- GitHub ruleset **Protect fork main** blocks force-pushes and deletion of `main`.
- `.vite-hooks/pre-push` runs `scripts/fork-upstream-sync.sh checks` before a push to `main`,
  refuses a push that would drop remote commits, and warns about untested code and edits to
  upstream-owned files. `FORK_SKIP_CHECKS=1` skips the checks. Without local dependencies it
  refuses the push and points to the branch path above.
- `scripts/fork-upstream-sync.sh footprint [REV]` lists upstream files the fork edits: the
  working tree by default, `HEAD` for committed work only. It and `checks` compare against
  `UPSTREAM_SHA` when set, otherwise against the upstream commit `HEAD` already contains, so a
  freshly fetched `upstream/main` does not count unmerged upstream changes as fork edits.
- Agent rules: `.agents/skills/fork-development/SKILL.md`, linked from `AGENTS.md`.

## Upstream edit budget

`scripts/fork-footprint-budget.json` caps changed lines in each upstream-owned file.
Newly touched or deleted upstream files have a zero budget. Fork-owned files do not consume it.
The explicit exception is `README.md`: it is now the fork's own landing page, preserved by
the merge helper and excluded from the mount budget. Its upstream counterpart remains linked.
The sync and pre-push checks reject growth before typechecking. This catches expanding
integration points before they become recurring conflicts. They also reject a budgeted file
whose fork diff falls to 0 lines, because that usually means a merge silently dropped a fork
mount: restore it, or run `--write` only if the feature was intentionally retired. A partial
reduction only prints a warning, since extractions and upstream refactors shrink mounts too;
verify the feature, then record the smaller budget with `--write`.

After reviewing an unavoidable mount change, commit it and run
`python3 scripts/fork-footprint-budget.py --write`, then review and commit the budget diff.
Never refresh the budget automatically in CI. The comparison uses the incorporated upstream
base, so unmerged upstream work does not inflate it. Upstream refactors can require a reviewed
budget adjustment even when the fork feature is unchanged.

## What the daily checks cover

Tests the fork adds or changes run automatically, so this map names anchors. A green sync
does not cover the right-hand column; check those on a device or in the named workflow before
a release that touches them.

| Fork capability                    | Daily sync runs                                                                                                                                                                                                                                                                                                                                                                                                | Not covered by the daily sync                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cache HUD and warming              | `packages/shared/src/cacheHud.test.ts`, `apps/server/src/orchestration-v2/ProjectionCacheHud.test.ts`, `Adapters/ClaudeAdapterV2.cacheTtl.test.ts`, `CacheWarmingService.test.ts`, `CacheWarmingDispatch.integration.test.ts`, upstream `ClaudeAdapterV2.test.ts` and `serverSettings.test.ts`                                                                                                                 | Web and mobile HUD rendering (`apps/web/src/components/chat/CacheHud.tsx`, `apps/mobile/src/features/threads/CacheHud.tsx`, `CacheWarmingControls.tsx`); a real warm-up turn                                                         |
| Order, groups, machine metadata    | Upstream `threadSort` tests in web and client-runtime, `Sidebar.logic`, `Sidebar.drag` and `Sidebar.pointer` tests, mobile `conversationListOptions`/`ConversationThreadListFilters`, `threadListV2.test.ts`, `mobileMachineContext.test.ts`, client-runtime `machineGroupStatus`, `serverLabel`, `slurmJob*`, fork-changed `supervisor` tests and pinned upstream `session.test.ts`, server `SlurmJob*` tests | Multi-machine layouts on screen                                                                                                                                                                                                      |
| Assistant citations                | `packages/shared/src/composerInlineTokens.test.ts`, web `ChatMarkdown` browser tests, mobile `composerCitationChipPresentation.test.ts` and `assistantCitationEditorToken.test.ts`                                                                                                                                                                                                                             | Mobile text selection to citation sheet (`apps/mobile/src/native/assistantCitationSelection.ts`, `apps/mobile/src/features/threads/AssistantCitationSheet.tsx`) on iOS and Android                                                   |
| Editors                            | Contracts, server, desktop and web `forkEditors`/`customEditor*` tests, `useConfiguredEditors.test.ts`, `forkLocalEditorActions.browser.test.ts`, upstream `OpenInPicker`, `editorPreferences` and `externalLauncher` tests                                                                                                                                                                                    | Launching an editor from the desktop app                                                                                                                                                                                             |
| Utilities and Termux               | Contracts `deviceUtilities`/`deviceCommands` tests, desktop `deviceUtilities`/`deviceCommands` tests, web `deviceCommands.logic.test.ts`, mobile `termuxCommands.logic.test.ts` and upstream `workspace-tabs-state.test.ts`                                                                                                                                                                                    | Kotlin `DeviceUtilitiesTest.kt`/`TermuxCommandsTest.kt` and the `t3-native-controls` compile run only in `.github/workflows/fork-device-commands.yml`, after a push to `main` touching its paths; a real Termux command on the phone |
| Built-in tailnet and notifications | `packages/client-runtime/src/connection/builtInTailnet.test.ts`, mobile `directNotifications.test.ts` and upstream `SettingsRouteScreen.logic.test.ts`                                                                                                                                                                                                                                                         | Go engine tests (`apps/mobile/modules/t3-tailnet/go`) and `DirectAgentEventsTest.kt` run only in `.github/workflows/release-fork.yml`; joining a tailnet and receiving Android notifications on the device                           |

All eight typechecks and the fork test groups run even if an earlier group fails, so one
validation run reports integration failures across packages.

The daily sync typechecks TypeScript only. Fork edits in upstream Kotlin files (for example
`T3WorkspaceNavigationModule.kt`) first compile in those two workflows.
