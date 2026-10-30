import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ScheduledTask,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import {
  scheduledTaskCreationReplay,
  type ScheduledTaskServiceUpsertInput,
} from "../scheduledTasks/scheduledTaskCreationReplay.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "./McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";

const shell = liveThreadShell(ThreadId.make("thread:automation-origin"));
const otherProject = ProjectId.make("project:automation-other");
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:automation"),
  requestNamespace: "automation-thread-mode",
  thread: {
    threadId: shell.id,
    providerSessionId: "automation-thread-mode",
    providerInstanceId: shell.providerInstanceId,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};
const schedule = { type: "interval", everyMs: 60_000 } as const;
const decodeScheduledTask = Schema.decodeUnknownEffect(ScheduledTask);

const fixture = Effect.gen(function* () {
  const tasks = yield* Ref.make<ReadonlyArray<ScheduledTask>>([]);
  const defaultBranch = yield* Ref.make<string | null>("trunk");
  const settings = ServerSettings.layerTest();
  const dependencies = Layer.mergeAll(
    settings,
    NodeCrypto.layer,
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadRecords: () => Effect.succeed(idleThreadProjection(shell)),
      getThreadShell: () => Effect.succeed(shell),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: (id) =>
        Effect.succeedSome({
          id,
          title: "Automation project",
          workspaceRoot: "/projects/automation",
          defaultModelSelection: shell.modelSelection,
          scripts: [],
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          deletedAt: null,
        }),
    }),
    Layer.mock(ScheduledTaskService.ScheduledTaskService)({
      list: () => Ref.get(tasks).pipe(Effect.map((tasks) => ({ tasks }))),
      upsert: (input: ScheduledTaskServiceUpsertInput) =>
        Effect.gen(function* () {
          const id =
            input.id ??
            (input.commandId ? `scheduled-task:${input.commandId}` : "scheduled-task:automation");
          const existing = (yield* Ref.get(tasks)).find((task) => task.id === id) ?? null;
          const replay = scheduledTaskCreationReplay(input, existing);
          if (replay !== null) return { task: replay };
          const { preserveExistingOnReplay: _preserve, ...fields } = input;
          const task = yield* decodeScheduledTask({
            ...fields,
            id,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            nextRunAt: null,
            lastRunAt: null,
            lastRunStatus: "never",
            lastRunError: null,
            runCount: 0,
          }).pipe(Effect.orDie);
          yield* Ref.update(tasks, (tasks) => [...tasks.filter((other) => other.id !== id), task]);
          return { task };
        }),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({}),
    Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      checkWorktreeBase: ({ projectId, workspaceStrategy }) =>
        workspaceStrategy.type === "worktree" && workspaceStrategy.baseRef === "main"
          ? Effect.fail(
              new ThreadLaunchService.ThreadLaunchBaseRefError({
                projectId,
                projectTitle: "Automation project",
                workspaceRoot: "/projects/automation",
                baseRef: workspaceStrategy.baseRef,
              }),
            )
          : Effect.void,
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      resolvePrimaryRemoteName: () => Effect.succeed("origin"),
      resolveDefaultBranchName: () => Ref.get(defaultBranch),
    }),
    Layer.mock(SecretRequests.SecretRequests)({}),
    Layer.mock(RemoteDelegation.RemoteDelegation)({}),
  );
  return {
    tasks,
    defaultBranch,
    layer: OrchestratorMcpService.layer.pipe(Layer.provide(dependencies), Layer.merge(settings)),
  };
});

it.effect(
  "uses the current creation preference without moving projects or overriding explicit choices",
  () =>
    Effect.gen(function* () {
      const { tasks, defaultBranch, layer } = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* OrchestratorMcpService.OrchestratorMcpService;
        const settings = yield* ServerSettings.ServerSettingsService;
        const create = (bindToCurrentThread?: boolean) =>
          service.scheduleTask(scope, {
            prompt: "Review later",
            schedule,
            ...(bindToCurrentThread === undefined ? {} : { bindToCurrentThread }),
          });
        expect((yield* create()).boundThreadId).toBeNull();
        expect((yield* Ref.get(tasks))[0]?.projectId).toBe(shell.projectId);
        expect((yield* Ref.get(tasks))[0]?.workspaceStrategy).toEqual({
          type: "worktree",
          baseRef: "trunk",
          startFromOrigin: true,
        });
        yield* Ref.set(defaultBranch, null);
        yield* create();
        expect((yield* Ref.get(tasks))[0]?.workspaceStrategy).toEqual({
          type: "worktree",
          baseRef: "HEAD",
          startFromOrigin: false,
        });
        expect((yield* create(true)).boundThreadId).toBe(shell.id);
        yield* settings.updateSettings({ scheduledTaskThreadMode: "current-thread" });
        expect((yield* create()).boundThreadId).toBe(shell.id);
        expect((yield* create(false)).boundThreadId).toBeNull();
        expect(
          (yield* service.scheduleTask(scope, {
            projectId: otherProject,
            prompt: "Review another project",
            schedule,
          })).boundThreadId,
        ).toBeNull();
        const invalid = yield* service
          .scheduleTask(scope, {
            projectId: otherProject,
            bindToCurrentThread: true,
            prompt: "Invalid",
            schedule,
          })
          .pipe(Effect.flip);
        expect(invalid.code).toBe("invalid_request");
        const clientScope = { ...scope, thread: undefined };
        expect(
          (yield* service.scheduleTask(clientScope, {
            projectId: shell.projectId,
            prompt: "Client automation",
            schedule,
          })).boundThreadId,
        ).toBeNull();
        expect(
          (yield* service
            .scheduleTask(clientScope, {
              projectId: shell.projectId,
              bindToCurrentThread: true,
              prompt: "Invalid",
              schedule,
            })
            .pipe(Effect.flip)).code,
        ).toBe("invalid_request");
      }).pipe(Effect.provide(layer));
    }),
);

it.effect(
  "preserves saved bindings and workspace choices until the binding is explicitly edited",
  () =>
    Effect.gen(function* () {
      const { tasks, layer } = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* OrchestratorMcpService.OrchestratorMcpService;
        const settings = yield* ServerSettings.ServerSettingsService;
        yield* service.scheduleTask(scope, {
          prompt: "Review later",
          schedule,
          bindToCurrentThread: true,
        });
        const scheduledTaskId = ScheduledTaskId.make("scheduled-task:automation");
        for (const workspaceStrategy of [
          { type: "root" },
          { type: "worktree", baseRef: "release", startFromOrigin: false },
          { type: "existing_worktree", worktreePath: "/projects/selected" },
        ] as const) {
          yield* Ref.update(tasks, (tasks) =>
            tasks.map((task) => ({ ...task, threadId: shell.id, workspaceStrategy })),
          );
          yield* settings.updateSettings({ scheduledTaskThreadMode: "new-thread" });
          expect(
            (yield* service.updateScheduledTask(scope, { scheduledTaskId, title: "Renamed" }))
              .boundThreadId,
          ).toBe(shell.id);
          expect(
            (yield* service.updateScheduledTask(scope, {
              scheduledTaskId,
              bindToCurrentThread: false,
            })).boundThreadId,
          ).toBeNull();
          const unbound =
            workspaceStrategy.type === "root"
              ? { type: "worktree", baseRef: "trunk", startFromOrigin: true }
              : workspaceStrategy;
          expect((yield* Ref.get(tasks))[0]?.workspaceStrategy).toEqual(unbound);
          yield* settings.updateSettings({ scheduledTaskThreadMode: "current-thread" });
          expect(
            (yield* service.updateScheduledTask(scope, { scheduledTaskId, enabled: false }))
              .boundThreadId,
          ).toBeNull();
          expect(
            (yield* service.updateScheduledTask(scope, {
              scheduledTaskId,
              bindToCurrentThread: true,
            })).boundThreadId,
          ).toBe(shell.id);
          expect((yield* Ref.get(tasks))[0]?.workspaceStrategy).toEqual(unbound);
        }
        const retried = {
          prompt: "Review later",
          schedule,
          bindToCurrentThread: true,
          clientRequestId: "retry-after-edit",
        } as const;
        const created = yield* service.scheduleTask(scope, retried);
        yield* Ref.update(tasks, (tasks) =>
          tasks.map((task) =>
            task.id === created.scheduledTaskId
              ? { ...task, title: "Edited by the user", threadId: null }
              : task,
          ),
        );
        const replayed = yield* service.scheduleTask(scope, retried);
        expect(replayed.title).toBe("Edited by the user");
        expect(replayed.boundThreadId).toBeNull();
      }).pipe(Effect.provide(layer));
    }),
);
