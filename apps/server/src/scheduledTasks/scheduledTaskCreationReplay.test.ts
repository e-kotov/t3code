import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

it.effect("a retried agent create returns the task it created", () =>
  Effect.gen(function* () {
    const service = yield* ScheduledTaskService.ScheduledTaskService;
    const input = yield* decodeUpsertInput({
      commandId: "schedule-request:replay",
      title: "Review later",
      prompt: "Review project",
      enabled: true,
      schedule: { type: "interval", everyMs: 60_000 },
      projectId: "project:normal",
      threadId: null,
      workspaceStrategy: { type: "worktree", baseRef: "trunk", startFromOrigin: true },
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    // The preference flipped between attempts, so the retry resolved another destination.
    const rebound = {
      ...input,
      threadId: ThreadId.make("thread:origin"),
      workspaceStrategy: { type: "root" } as const,
    };
    const created = yield* service.upsert({ ...input, keepExistingOnReplay: true });
    const replayed = yield* service.upsert({ ...rebound, keepExistingOnReplay: true });
    expect(replayed.task).toEqual(created.task);

    const { commandId: _commandId, ...edit } = rebound;
    const edited = yield* service.upsert({ ...edit, id: created.task.id });
    expect(edited.task.threadId).toBe(rebound.threadId);
  }).pipe(
    Effect.provide(
      ScheduledTaskService.layer.pipe(
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
        Layer.provideMerge(SqlitePersistence.layerMemory),
      ),
    ),
  ),
);
