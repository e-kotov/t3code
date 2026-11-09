# Upstream sync

This fork follows `pingdotgg/t3code` `main` continuously. Releases (`vX.Y.Z-ek.N`, see
[fork-release.md](fork-release.md)) are cut from fork `main` whenever a checkpoint is wanted;
they are not tied to upstream stable releases.

## Daily automation

`.github/workflows/upstream-sync.yml` runs daily at 02:00 UTC (03:00 CET / 04:00 CEST Berlin time) and on manual dispatch. It runs
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
   `scripts/fork-feature-guard.py check` also fails if a file the fork owned on `main` is
   missing after the merge, if a fork test protects no feature in `scripts/fork-features.json`,
   or if the README feature list no longer matches that manifest. When upstream deletes an
   upstream test the fork had changed, the fork's copy becomes fork-owned and must be registered,
   which holds that resolution for approval.
   A separate `native` job then runs the fork's Go engine tests and Kotlin unit tests
   (`.github/actions/fork-native-tests`, also run on pull requests by `fork-native-tests.yml`).
   A native failure keeps `main` unchanged; on a scheduled sync it is not handed to the resolver,
   which cannot run Gradle, so GitHub's failure email is the signal.
4. If the checks pass, the merge commit is pushed to `main`. Upstream workflows that became active are
   disabled; fork-owned workflows (the kept list and every `fork-*.yml`) stay enabled.

## Conflicts and failed checks: Claude Code and Pi

When a sync started from `main` still has conflicts after mergiraf, the merge step commits the
conflicted merge, markers included. When it merged cleanly but a check failed, its merge is kept
as it is. Either way the run uploads it as `upstream-handoff`, and
`.github/workflows/claude-sync.yml` resolves it with Claude Code and Pi. The preferred agent and
fallback order defaults to `claude,pi`; set the repository Actions variable
`UPSTREAM_RESOLVER_ORDER` to `pi,claude` to prefer Pi. Set it in **Settings → Secrets and
variables → Actions → Variables**; leave it unset to keep Claude first. Invalid values fail before
either model runs.

Claude uses its pinned CLI, the Claude Platform key `ANTHROPIC_API_KEY`, and the workspace's
monthly spend limit. Pi uses its pinned CLI, Vercel AI Gateway, and the `VERCEL_AI_GATEWAY_API_KEY`
repository secret. A failed API call or invalid review result advances to the next agent in the
configured order. A completed fix that later fails review or checks follows the normal review and
follow-up stages; it does not trigger fallback by itself.

1. **Fix**: the first available resolver gets
   [`.github/claude/fix-upstream-sync.md`](../../.github/claude/fix-upstream-sync.md) plus the
   conflicted files or an excerpt of the failed checks' error lines
   (`scripts/fork-sync-excerpt.py`). Vite+ is bootstrapped from clean fork-main manifests. Both
   agents are installed outside the candidate, so conflicted package files cannot prevent them
   starting. An initial dependency install may fail; its error goes into the resolver's context.
   The selected resolver addresses manifest and lockfile conflicts, installs dependencies, then
   typechecks and tests what it touches. Pi uses `meta/muse-spark-1.3-contributor` through AI
   Gateway at `xhigh` thinking. Meta does not support `max` for the Contributor model. If the
   first agent exits after making partial changes, the next agent is told to inspect and continue
   from the current worktree.
2. **Review**: a second, read-only run by the first available resolver reviews only that fix
   ([`.github/claude/review-upstream-sync.md`](../../.github/claude/review-upstream-sync.md)) and
   returns a structured verdict.
3. **Follow-up fix**, once: the first available resolver addresses the review's findings or, if
   the review approved, a failed check of the resolution.
4. A mandatory `vp install --frozen-lockfile` must pass after the fix/review cycle. Initial
   installation failure never bypasses this gate. A requested product decision still stops the run.
5. The workflow rebuilds one merge commit with the original parents (fork `main`, upstream), pushes
   it as `sync/claude-<UTC time>` from a job that runs no repository code, and dispatches this
   workflow with `promote_only`. The usual checks decide promotion; the branch is deleted after
   it. A resolution that passes but changed fork-owned tests or guard files
   (`scripts/fork-features.json`, `scripts/fork-footprint-budget.json`), or shrank fork mounts
   in upstream files, is not pushed to `main`: `scripts/fork-feature-guard.py approval` lists
   why, and the run opens an issue titled "Upstream sync awaiting approval: <branch>". Egor
   approves by opening the prefilled pull request the issue links (it carries `Closes #<issue>`) and
   merging it;
   merging closes the issue, and the repository deletes merged branches. He rejects by deleting
   the branch and closing the issue.
   Replaying the syncs since 27 October, 8 of 11 resolutions would have waited.
   If they fail after the follow-up is used, or the resolver writes
   `.claude-needs-decision.md`, the run fails (GitHub emails it) and the branch stays for Egor.
   Decision requests also appear in
   the job log and the downloadable `claude-decision` artifact, so `gh run view --log-failed` or
   `gh run download -n claude-decision` can retrieve them without a browser login. While a
   `sync/claude-*` branch exists, no new resolution starts; delete it to re-enable automatic resolution.

Each Claude CLI run has a spend cap (`--max-budget-usd`: fix 10, review 4, follow-up 8 US dollars).
Configure a separate, budgeted Vercel AI Gateway API key for Pi; Gateway key budgets are soft caps,
and the request that crosses a limit may still finish. The Contributor model grants Meta permission
to use submitted prompts, code, files, context, and responses to train future models; use the
standard Muse Spark model instead if that data use is not acceptable. See [Meta's Contributor mode
terms](https://dev.meta.ai/docs/pricing-rate-limits) and [Vercel Gateway budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets).

The resolver job runs repository code with the selected model credential in its environment and
has no push credential. The separate promotion job runs no repository code. As before, keep the
Claude workspace spend limit and the Gateway key budget bounded.

Workflow changes run `scripts/claude-sync.test.py` without a model call. The regression executes
actual workflow shell steps with a failed installer and checks that the preferred resolver runs,
Pi takes over when Claude's API call fails, the resolver order can be reversed, an unrepaired
lockfile still blocks validation, and bootstrap uses clean manifests. To exercise
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
failed `sync/claude-*` check never reached the resolver workflow.

## Resolving a blocked sync

Every agent-authored change goes through a feature branch and a pull request to
`e-kotov/t3code` main, including tiny changes and manual conflict resolution. Start from
`origin/main`; do not develop or commit on local main, push work directly to main, or
manually use the sync workflow's branch promotion as a substitute for a PR. The scheduled
sync and resolver jobs described above are separate automation, not the manual delivery path.

Keep Greptile enabled for substantive work. For a very minor change, or when Egor explicitly
requests it, create the PR with the `skip-greptile` label. The checked-in `greptile.json`
uses `disabledLabels` for this; a title tag or Git tag does not replace the label. CI and any
requested independent review still apply. Apply the label at creation, before review starts.

Egor's Mac keeps no `node_modules` (10–20 GB). Resolve conflicts with git alone and let the
PR's GitHub checks validate the result. A manual upstream merge preserves both sides' intent;
`rerere` is enabled, and the merge helper can use mergiraf. Check cleanly merged fork mounts too.

```sh
git fetch origin main
git fetch upstream main
git switch -c sync/upstream-$(date +%F) origin/main
bash scripts/fork-merge-upstream.sh upstream/main "Merge upstream main"
# Resolve remaining conflicts and inspect all fork mounts.
VP_GIT_HOOKS=0 git commit --no-edit
git push -u origin HEAD
gh pr create --repo e-kotov/t3code --base main
```

`VP_GIT_HOOKS=0` skips the dependency-based local hook; it does not waive hosted checks or
review. Merge the PR only when the user's endpoint authorizes it and required checks and
reviews pass. Never rewrite main or disable its protection to complete agent work.

Changed syncs also run `vp run check:changed` against
`origin/main`, including formatting, lint, knip, affected-package typechecks and adjacent
tests. All changed syncs check formatting before browser setup. Failed changed syncs upload a
`fork-format-fixes` patch artifact when the formatter is available; apply any needed changes
locally, review the diff and rerun.
The runner never promotes uncommitted formatter changes.

Keep fork logic in fork-owned files with small mount points in upstream files; this keeps
future conflicts small. See `.agents/skills/fork-development/SKILL.md` for the branch and PR rules.

## Guards for fork development

- GitHub ruleset **Protect fork main** blocks force-pushes and deletion of `main`.
- `.vite-hooks/pre-push` runs `scripts/fork-upstream-sync.sh checks` before a push to `main`,
  refuses a push that would drop remote commits, and warns about untested code and edits to
  upstream-owned files. `FORK_SKIP_CHECKS=1` skips the checks. Without local dependencies it
  refuses the push. Its legacy direct-push advice is not an authorization to bypass the
  feature-branch and PR rules above.
- `scripts/fork-upstream-sync.sh footprint [REV]` lists upstream files the fork edits: the
  working tree by default, `HEAD` for committed work only. It and `checks` compare against
  `UPSTREAM_SHA` when set, otherwise against the upstream commit `HEAD` already contains, so a
  freshly fetched `upstream/main` does not count unmerged upstream changes as fork edits.
- Agent rules: `.agents/skills/fork-development/SKILL.md`, linked from `AGENTS.md`.
- `scripts/fork-features.json` lists each fork feature with its guide and the tests that protect
  it. Every fork-owned test must belong to a feature, and the README feature list between the
  `fork-features` markers is generated from it with
  `python3 scripts/fork-feature-guard.py readme --write`. `.github/workflows/fork-feature-guard.yml`
  checks both on every pull request.

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

| Fork capability                    | Daily sync runs                                                                                                                                                                                                                                                                                                                                                                                                | Not covered by the daily sync                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache HUD and warming              | `packages/shared/src/cacheHud.test.ts`, `apps/server/src/orchestration-v2/ProjectionCacheHud.test.ts`, `Adapters/ClaudeAdapterV2.cacheTtl.test.ts`, `CacheWarmingService.test.ts`, `CacheWarmingDispatch.integration.test.ts`, upstream `ClaudeAdapterV2.test.ts` and `serverSettings.test.ts`                                                                                                                 | Web and mobile HUD rendering (`apps/web/src/components/chat/CacheHud.tsx`, `apps/mobile/src/features/threads/CacheHud.tsx`, `CacheWarmingControls.tsx`); a real warm-up turn                  |
| Order, groups, machine metadata    | Upstream `threadSort` tests in web and client-runtime, `Sidebar.logic`, `Sidebar.drag` and `Sidebar.pointer` tests, mobile `conversationListOptions`/`ConversationThreadListFilters`, `threadListV2.test.ts`, `mobileMachineContext.test.ts`, client-runtime `machineGroupStatus`, `serverLabel`, `slurmJob*`, fork-changed `supervisor` tests and pinned upstream `session.test.ts`, server `SlurmJob*` tests | Multi-machine layouts on screen                                                                                                                                                               |
| Assistant citations                | `packages/shared/src/composerInlineTokens.test.ts`, web `ChatMarkdown` browser tests, mobile `composerCitationChipPresentation.test.ts` and `assistantCitationEditorToken.test.ts`                                                                                                                                                                                                                             | Mobile text selection to citation sheet (`apps/mobile/src/native/assistantCitationSelection.ts`, `apps/mobile/src/features/threads/AssistantCitationSheet.tsx`) on iOS and Android            |
| Editors                            | Contracts, server, desktop and web `forkEditors`/`customEditor*` tests, `useConfiguredEditors.test.ts`, `forkLocalEditorActions.browser.test.ts`, upstream `OpenInPicker`, `editorPreferences` and `externalLauncher` tests                                                                                                                                                                                    | Launching an editor from the desktop app                                                                                                                                                      |
| Utilities and Termux               | Contracts `deviceUtilities`/`deviceCommands` tests, desktop `deviceUtilities`/`deviceCommands` tests, web `deviceCommands.logic.test.ts`, mobile `termuxCommands.logic.test.ts` and upstream `workspace-tabs-state.test.ts`                                                                                                                                                                                    | Kotlin `DeviceUtilitiesTest.kt`/`TermuxCommandsTest.kt` and the `t3-native-controls` compile run in the sync's `native` job, not in its TypeScript checks; a real Termux command on the phone |
| Built-in tailnet and notifications | `packages/client-runtime/src/connection/builtInTailnet.test.ts`, mobile `directNotifications.test.ts` and upstream `SettingsRouteScreen.logic.test.ts`                                                                                                                                                                                                                                                         | Go engine tests (`apps/mobile/modules/t3-tailnet/go`) and `DirectAgentEventsTest.kt` run in the sync's `native` job; joining a tailnet and receiving Android notifications on the device      |

All eight typechecks and the fork test groups run even if an earlier group fails, so one
validation run reports integration failures across packages.

The sync's TypeScript checks do not compile Kotlin; its `native` job compiles the fork's Android
modules, including fork edits in upstream Kotlin files such as `T3WorkspaceNavigationModule.kt`.
