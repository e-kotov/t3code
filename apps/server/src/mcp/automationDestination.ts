import type { ProjectId, ScheduledTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

type WorkspaceStrategy = ScheduledTask["workspaceStrategy"];

export function defaultScheduledTaskBinding(
  requested: boolean | undefined,
  useCurrentThread: boolean,
  hasMatchingThread: boolean,
): boolean {
  return requested ?? (useCurrentThread && hasMatchingThread);
}

// Preserve upstream default-branch selection, with fallbacks for plain folders and missing refs.
export function scheduledTaskWorkspaces<E, R>(
  requireProject: (projectId: ProjectId) => Effect.Effect<{ readonly workspaceRoot: string }, E, R>,
  git: Pick<
    GitVcsDriver.GitVcsDriver["Service"],
    "resolveCommit" | "resolvePrimaryRemoteName" | "resolveDefaultBranchName" | "remoteBranchExists"
  >,
  upstream: (boundToThread: boolean, projectId: ProjectId) => Effect.Effect<WorkspaceStrategy, E, R>,
) {
  return Effect.fn("OrchestratorMcpService.scheduledTaskWorkspace")(function* (
    projectId: ProjectId,
    boundToThread: boolean,
  ) {
    if (boundToThread) return yield* upstream(boundToThread, projectId);
    const cwd = (yield* requireProject(projectId)).workspaceRoot;
    const hasCommit = (revision: string) =>
      git.resolveCommit({ cwd, revision }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    // A plain folder, or a repository without commits, cannot host a worktree.
    if (!(yield* hasCommit("HEAD"))) return { type: "root" } satisfies WorkspaceStrategy;
    const strategy = yield* upstream(boundToThread, projectId);
    if (strategy.type !== "worktree" || (yield* hasCommit(strategy.baseRef))) return strategy;
    const remote = yield* git.resolvePrimaryRemoteName(cwd).pipe(Effect.orElseSucceed(() => null));
    const defaultBranch =
      remote === null
        ? null
        : yield* git.resolveDefaultBranchName(cwd, remote).pipe(Effect.orElseSucceed(() => null));
    for (const branch of new Set([defaultBranch ?? strategy.baseRef, strategy.baseRef])) {
      if (yield* hasCommit(`refs/heads/${branch}`)) return { ...strategy, baseRef: branch };
      // Launch maps a bare name only to `origin`, so keep the remote a tracking ref belongs to.
      const onRemote =
        remote !== null &&
        (yield* git
          .remoteBranchExists({ cwd, remoteName: remote, refName: branch })
          .pipe(Effect.orElseSucceed(() => false)));
      if (onRemote) return { ...strategy, baseRef: `${remote}/${branch}` };
    }
    return {
      type: "worktree",
      baseRef: "HEAD",
      startFromOrigin: false,
    } satisfies WorkspaceStrategy;
  });
}
