import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ProjectId, ScheduledTaskUpsertInput, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { idleThreadProjection, liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

it.effect("each unbound run launches in its saved project, including scratch projects", () =>
  Effect.gen(function* () {
    const launches = yield* Ref.make<ReadonlyArray<ThreadLaunchService.ThreadLaunchInput>>([]);
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeCrypto.layer,
          Scheduler.layer,
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: (input) =>
              Effect.gen(function* () {
                const count = yield* Ref.modify(launches, (previous) => [
                  previous.length + 1,
                  [...previous, input],
                ]);
                const threadId = ThreadId.make(`thread:automation-run-${count}`);
                return {
                  threadId,
                  projection: idleThreadProjection(liveThreadShell(threadId)),
                  resumed: false,
                };
              }),
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: (projectId) => Effect.succeed(projectId === "project:scratch"),
          }),
          Layer.mock(SecretRequests.SecretRequests)({}),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      for (const projectId of ["project:normal", "project:scratch"]) {
        const input = yield* decodeUpsertInput({
          title: "Review later",
          prompt: "Review project",
          enabled: true,
          schedule: { type: "interval", everyMs: 60_000 },
          projectId,
          threadId: null,
          workspaceStrategy: { type: "worktree", baseRef: "release", startFromOrigin: false },
          modelSelection: { instanceId: "codex", model: "gpt-5" },
          runtimeMode: "full-access",
          interactionMode: "default",
        });
        const { task } = yield* service.upsert(input);
        const first = yield* service.runNow({ id: task.id });
        yield* TestClock.adjust(1);
        const second = yield* service.runNow({ id: task.id });
        expect(first.threadId).not.toBeNull();
        expect(second.threadId).not.toBe(first.threadId);
        expect(second.task.threadId).toBeNull();
        const pair = (yield* Ref.get(launches)).slice(-2);
        expect(pair.map((launch) => launch.projectId)).toEqual([projectId, projectId]);
        expect(new Set(pair.map((launch) => launch.commandId)).size).toBe(2);
        expect(pair.map((launch) => launch.workspaceStrategy)).toEqual([
          task.workspaceStrategy,
          task.workspaceStrategy,
        ]);
        expect(task.workspaceStrategy).toEqual(
          projectId === "project:scratch" ? { type: "root" } : input.workspaceStrategy,
        );
      }
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("an idempotent create keeps saved placement unless a binding was explicitly chosen", () =>
  Effect.gen(function* () {
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeCrypto.layer,
          Scheduler.layer,
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
          Layer.mock(ThreadManagementService.ThreadManagementService)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          Layer.mock(SecretRequests.SecretRequests)({}),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-request:replay",
        title: "Review later",
        prompt: "Review project",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project:normal",
        threadId: null,
        workspaceStrategy: { type: "existing_worktree", worktreePath: "/projects/selected" },
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert({ ...input, preserveExistingOnReplay: true });
      const newDefault = {
        ...input,
        threadId: ThreadId.make("thread:origin"),
        workspaceStrategy: { type: "root" } as const,
      };
      const replayed = yield* service.upsert({
        ...newDefault,
        projectId: ProjectId.make("project:changed-after-creation"),
        prompt: "A retry must not rewrite an existing task",
        preserveExistingOnReplay: true,
      });
      expect(replayed.task).toEqual(created.task);
      const explicit = yield* service.upsert({ ...newDefault, preserveExistingOnReplay: false });
      expect(explicit.task.threadId).toBe(newDefault.threadId);
      expect(explicit.task.workspaceStrategy).toEqual(newDefault.workspaceStrategy);
      const replayedBound = yield* service.upsert({
        ...input,
        prompt: "A lower-mode retry must not alter bound work",
        runtimeMode: "approval-required",
        preserveExistingOnReplay: true,
      });
      expect(replayedBound.task).toEqual(explicit.task);
      yield* service.delete({ id: created.task.id });
      const recreated = yield* service.upsert({ ...input, preserveExistingOnReplay: true });
      expect(recreated.task.threadId).toBeNull();
      expect(recreated.task.workspaceStrategy).toEqual(input.workspaceStrategy);
      const { commandId: _commandId, ...withoutCommand } = newDefault;
      const ordinaryEdit = yield* service.upsert({
        ...withoutCommand,
        id: created.task.id,
        preserveExistingOnReplay: true,
      });
      expect(ordinaryEdit.task.threadId).toBe(newDefault.threadId);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
