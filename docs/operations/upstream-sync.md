# Upstream sync

This fork follows `pingdotgg/t3code` `main` continuously. Releases (`vX.Y.Z-ek.N`, see
[fork-release.md](fork-release.md)) are cut from fork `main` whenever a checkpoint is wanted;
they are not tied to upstream stable releases.

## Daily automation

`.github/workflows/upstream-sync.yml` runs at 03:17, 09:17, 15:17 and 21:17 UTC and on manual dispatch. It runs
`scripts/fork-upstream-sync.sh`:

1. `merge` merges upstream `main` into fork `main`. If upstream is already contained, it stops.
2. `checks` first rejects any growth beyond the reviewed per-file upstream-edit budget, then typechecks contracts, shared, client-runtime, server, web, mobile and desktop, then
   runs every test file the fork added or changed relative to upstream, plus the upstream tests
   beside upstream files the fork mounts into (listed in the script) and the mobile React
   Compiler coverage test. Web browser tests run in headless Chromium on the runner.
3. If both pass, the merge commit is pushed to `main`. Upstream workflows that became active are
   disabled; only fork-owned workflows stay enabled.

A conflict or failed check leaves `main` unchanged and fails the run. GitHub emails the
failure; the run summary lists the conflicting files. The next scheduled run retries automatically,
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
The sync and pre-push checks reject growth before typechecking; reductions pass.
This catches expanding integration points before they become recurring conflicts.

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

All seven typechecks and the fork test groups run even if an earlier group fails, so one
validation run reports integration failures across packages.

The daily sync typechecks TypeScript only. Fork edits in upstream Kotlin files (for example
`T3WorkspaceNavigationModule.kt`) first compile in those two workflows.
