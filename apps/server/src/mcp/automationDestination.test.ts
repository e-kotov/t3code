import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { defaultScheduledTaskBinding, scheduledTaskWorkspaces } from "./automationDestination.ts";

const upstream = { type: "worktree", baseRef: "main", startFromOrigin: true } as const;
const commit = ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "c"];

it("uses the environment preference only when no destination was requested", () => {
  expect(defaultScheduledTaskBinding(undefined, false, true)).toBe(false);
  expect(defaultScheduledTaskBinding(undefined, true, true)).toBe(true);
  expect(defaultScheduledTaskBinding(undefined, true, false)).toBe(false);
  expect(defaultScheduledTaskBinding(false, true, true)).toBe(false);
  expect(defaultScheduledTaskBinding(true, false, true)).toBe(true);
  expect(defaultScheduledTaskBinding(true, false, false)).toBe(true);
});

it.effect("bases new-thread worktrees on a branch the checkout has", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const workspaceFor = (setup: ReadonlyArray<ReadonlyArray<string>>, boundToThread = false) =>
      Effect.gen(function* () {
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-automation-" });
        for (const args of setup) yield* git.execute({ operation: "test.setupRepo", cwd, args });
        return yield* scheduledTaskWorkspaces(
          () => Effect.succeed({ workspaceRoot: cwd }),
          git,
          (bound) => (bound ? { type: "root" } : upstream),
        )(ProjectId.make("project:automation"), boundToThread);
      });
    const head = { type: "worktree", baseRef: "HEAD", startFromOrigin: false };

    expect(yield* workspaceFor([])).toEqual({ type: "root" });
    expect(yield* workspaceFor([["init", "-b", "main"]])).toEqual({ type: "root" });
    expect(yield* workspaceFor([["init", "-b", "main"], commit])).toEqual(upstream);
    expect(yield* workspaceFor([["init", "-b", "master"], commit])).toEqual(head);
    // A remote alone must not make an absent `main` look usable.
    expect(
      yield* workspaceFor([
        ["init", "-b", "master"],
        commit,
        ["remote", "add", "origin", "/nonexistent/remote.git"],
        ["update-ref", "refs/remotes/origin/master", "HEAD"],
      ]),
    ).toEqual(head);
    expect(
      yield* workspaceFor([
        ["init", "-b", "master"],
        commit,
        ["remote", "add", "origin", "/nonexistent/remote.git"],
        ["update-ref", "refs/remotes/origin/trunk", "HEAD"],
        ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"],
      ]),
    ).toEqual({ ...upstream, baseRef: "trunk" });
    expect(yield* workspaceFor([["init", "-b", "master"], commit], true)).toEqual({
      type: "root",
    });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      GitVcsDriver.layer.pipe(
        Layer.provideMerge(VcsProcess.layer),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-automation-" }).pipe(
            Layer.provide(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
