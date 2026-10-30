import type { ProjectId, ScheduledTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

type WorkspaceStrategy = ScheduledTask["workspaceStrategy"];

export function defaultScheduledTaskBinding(
  requested: boolean | undefined,
  useCurrentThread: boolean,
  hasMatchingThread: boolean,
): boolean {
  return requested ?? (useCurrentThread && hasMatchingThread);
}

// Upstream bases new-thread runs on `main`, which fails every run in repos without one.
export function scheduledTaskWorkspaces<E, R>(
  requireProject: (
    projectId: ProjectId,
  ) => Effect.Effect<{ readonly id: ProjectId; readonly workspaceRoot: string }, E, R>,
  git: Pick<
    GitVcsDriver.GitVcsDriver["Service"],
    "resolvePrimaryRemoteName" | "resolveDefaultBranchName"
  >,
  threadLaunch: Pick<ThreadLaunchService.ThreadLaunchService["Service"], "checkWorktreeBase">,
  upstream: (boundToThread: boolean) => WorkspaceStrategy,
) {
  return Effect.fn("OrchestratorMcpService.scheduledTaskWorkspace")(function* (
    projectId: ProjectId,
    boundToThread: boolean,
  ) {
    const strategy = upstream(boundToThread);
    if (strategy.type !== "worktree") return strategy;
    const project = yield* requireProject(projectId);
    const cwd = project.workspaceRoot;
    const remote = yield* git.resolvePrimaryRemoteName(cwd).pipe(Effect.orElseSucceed(() => null));
    const defaultBranch =
      remote === null
        ? null
        : yield* git.resolveDefaultBranchName(cwd, remote).pipe(Effect.orElseSucceed(() => null));
    const preferred: WorkspaceStrategy =
      defaultBranch === null ? strategy : { ...strategy, baseRef: defaultBranch };
    return yield* threadLaunch
      .checkWorktreeBase({ projectId: project.id, workspaceStrategy: preferred })
      .pipe(
        Effect.as(preferred),
        Effect.orElseSucceed((): WorkspaceStrategy => ({
          type: "worktree",
          baseRef: "HEAD",
          startFromOrigin: false,
        })),
      );
  });
}
