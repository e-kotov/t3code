import { OrchestratorMcpFailure, type ProjectId, type ScheduledTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import type * as ServerSettings from "../serverSettings.ts";
import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

type WorkspaceStrategy = ScheduledTask["workspaceStrategy"];
type Project = { readonly id: ProjectId; readonly workspaceRoot: string };

export function scheduledTaskThreads<E, R>(
  settings: ServerSettings.ServerSettingsService["Service"],
  git: GitVcsDriver.GitVcsDriver["Service"],
  threadLaunch: ThreadLaunchService.ThreadLaunchService["Service"],
  requireProject: (projectId: ProjectId) => Effect.Effect<Project, E, R>,
  newThreadWorkspace: WorkspaceStrategy,
) {
  const bindsByDefault = (callerProjectId: ProjectId | undefined, projectId: ProjectId) =>
    callerProjectId !== projectId
      ? Effect.succeed(false)
      : settings.getSettings.pipe(
          Effect.map((current) => current.scheduledTaskThreadMode === "current-thread"),
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: "Unable to read server settings.",
              }),
          ),
        );

  // Upstream bases new-thread runs on `main`; prefer the project's default branch, then its HEAD.
  const resolve = Effect.fn("OrchestratorMcpService.resolveScheduledTaskWorkspace")(function* (
    project: Project,
  ) {
    if (newThreadWorkspace.type !== "worktree") return newThreadWorkspace;
    const cwd = project.workspaceRoot;
    const remote = yield* git.resolvePrimaryRemoteName(cwd).pipe(Effect.orElseSucceed(() => null));
    const defaultBranch =
      remote === null
        ? null
        : yield* git.resolveDefaultBranchName(cwd, remote).pipe(Effect.orElseSucceed(() => null));
    const preferred: WorkspaceStrategy =
      defaultBranch === null
        ? newThreadWorkspace
        : { ...newThreadWorkspace, baseRef: defaultBranch };
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

  const workspace = (project: Project, bindToCurrentThread: boolean) =>
    bindToCurrentThread ? Effect.succeed<WorkspaceStrategy>({ type: "root" }) : resolve(project);

  // Bound runs ignore the workspace, so keep the user's choice, except a shared checkout.
  const rebind = (existing: ScheduledTask, bindToCurrentThread: boolean) =>
    bindToCurrentThread || existing.workspaceStrategy.type !== "root"
      ? Effect.succeed(existing.workspaceStrategy)
      : requireProject(existing.projectId).pipe(Effect.flatMap(resolve));

  return { bindsByDefault, workspace, rebind };
}
