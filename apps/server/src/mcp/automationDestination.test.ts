import { it as effectIt } from "@effect/vitest";
import { GitCommandError, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { ThreadLaunchBaseRefError } from "../orchestration-v2/ThreadLaunchService.ts";
import { defaultScheduledTaskBinding, scheduledTaskWorkspaces } from "./automationDestination.ts";

const project = { id: ProjectId.make("project:automation"), workspaceRoot: "/projects/automation" };
const upstream = { type: "worktree", baseRef: "main", startFromOrigin: true } as const;
const noRemote = new GitCommandError({
  operation: "resolvePrimaryRemoteName",
  command: "git",
  cwd: project.workspaceRoot,
  detail: "No remote.",
});
const git = (defaultBranch: string | null) => ({
  resolvePrimaryRemoteName: () => Effect.succeed("origin"),
  resolveDefaultBranchName: () => Effect.succeed(defaultBranch),
});
const existingRefs = (
  ...refs: ReadonlyArray<string>
): Parameters<typeof scheduledTaskWorkspaces>[2] => ({
  checkWorktreeBase: ({ workspaceStrategy }) =>
    workspaceStrategy.type !== "worktree" || refs.includes(workspaceStrategy.baseRef)
      ? Effect.void
      : Effect.fail(
          new ThreadLaunchBaseRefError({
            projectId: project.id,
            projectTitle: "Automation",
            workspaceRoot: project.workspaceRoot,
            baseRef: workspaceStrategy.baseRef,
          }),
        ),
});

describe("scheduled task destination", () => {
  it("uses the environment preference only when no destination was requested", () => {
    expect(defaultScheduledTaskBinding(undefined, false, true)).toBe(false);
    expect(defaultScheduledTaskBinding(undefined, true, true)).toBe(true);
    expect(defaultScheduledTaskBinding(undefined, true, false)).toBe(false);
    expect(defaultScheduledTaskBinding(false, true, true)).toBe(false);
    expect(defaultScheduledTaskBinding(true, false, true)).toBe(true);
    expect(defaultScheduledTaskBinding(true, false, false)).toBe(true);
  });

  effectIt.effect("bases new-thread worktrees on a branch the project has", () =>
    Effect.gen(function* () {
      const run = (
        driver: Parameters<typeof scheduledTaskWorkspaces>[1],
        refs: ReadonlyArray<string>,
        boundToThread = false,
      ) =>
        scheduledTaskWorkspaces(
          () => Effect.succeed(project),
          driver,
          existingRefs(...refs),
          (bound) => (bound ? { type: "root" } : upstream),
        )(project.id, boundToThread);

      expect(yield* run(git("trunk"), ["trunk"])).toEqual({ ...upstream, baseRef: "trunk" });
      expect(yield* run(git(null), ["main"])).toEqual(upstream);
      expect(yield* run(git(null), ["master"])).toEqual({
        type: "worktree",
        baseRef: "HEAD",
        startFromOrigin: false,
      });
      expect(
        yield* run(
          {
            resolvePrimaryRemoteName: () => Effect.fail(noRemote),
            resolveDefaultBranchName: () => Effect.succeed("trunk"),
          },
          ["master"],
        ),
      ).toEqual({ type: "worktree", baseRef: "HEAD", startFromOrigin: false });
      expect(yield* run(git("trunk"), [], true)).toEqual({ type: "root" });
    }),
  );
});
