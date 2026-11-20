import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestratorMcpScheduleTaskInput,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTaskUpsertInput,
  type ServerProvider,
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
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "./McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";

const projectId = ProjectId.make("project:scheduled-model");
const providerInstanceId = ProviderInstanceId.make("kodex");
const model = "gpt-6-mitarbeitende";
const runAt = "2030-01-08T08:00:00.000Z";
const threadId = ThreadId.make("thread:calling-scheduler");
const caller = { ...liveThreadShell(threadId, { runtimeMode: "approval-required" }), projectId };
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:scheduled-model"),
  requestNamespace: "provider-session:scheduled-model",
  thread: {
    threadId,
    providerSessionId: "provider-session:scheduled-model",
    providerInstanceId: caller.providerInstanceId,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};
const provider: ServerProvider = {
  instanceId: providerInstanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-20T00:00:00.000Z",
  models: [
    {
      slug: model,
      name: model,
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning effort",
            type: "select",
            options: [{ id: "high", label: "High" }],
          },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
};

const service = (saved: Ref.Ref<ReadonlyArray<ScheduledTaskUpsertInput>>) =>
  OrchestratorMcpService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NodeCrypto.layer,
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () => Effect.succeed(idleThreadProjection(caller)),
          getThreadShell: () => Effect.succeed(caller),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          resolvePrimaryRemoteName: () => Effect.succeed("origin"),
          resolveDefaultBranchName: () => Effect.succeed("main"),
          resolveCommit: () => Effect.succeed({ commitSha: "abc123" }),
        }),
        ServerSettings.layerTest({
          agentScheduledTasksUseCurrentThread: true,
          providerInstances: { [providerInstanceId]: { driver: provider.driver, enabled: true } },
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
        Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
          list: () => Effect.succeed([providerInstanceId]),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({
              id: projectId,
              workspaceRoot: "/repo",
              defaultModelSelection: null,
            } as never),
        }),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(RemoteDelegation.RemoteDelegation)({}),
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({
          upsert: (input) =>
            Ref.update(saved, (all) => [...all, input]).pipe(
              Effect.as({
                task: {
                  ...input,
                  id: ScheduledTaskId.make("scheduled-task:model"),
                  threadId: null,
                  schedule: { type: "once" as const, runAt },
                  createdBy: "agent" as const,
                  creationSource: "mcp" as const,
                  createdAt: "2026-11-20T00:00:00.000Z",
                  updatedAt: "2026-11-20T00:00:00.000Z",
                  nextRunAt: runAt,
                  lastRunAt: null,
                  lastRunStatus: "never" as const,
                  lastRunError: null,
                  runCount: 0,
                },
              }),
            ),
        }),
      ),
    ),
  );

const decode = Schema.decodeUnknownSync(OrchestratorMcpScheduleTaskInput);
const request = decode({
  projectId,
  bindToCurrentThread: false,
  schedule: { type: "once", runAt },
  prompt: "Review the skills.",
  target: { providerInstanceId, model, options: { reasoningEffort: "high" } },
});

it.effect("saves a one-time run and its model without creating a thread", () =>
  Effect.gen(function* () {
    const saved = yield* Ref.make<ReadonlyArray<ScheduledTaskUpsertInput>>([]);
    const mcp = yield* OrchestratorMcpService.OrchestratorMcpService.pipe(
      Effect.provide(service(saved)),
    );
    const result = yield* mcp.scheduleTask(scope, request);
    const selection = {
      instanceId: providerInstanceId,
      model,
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const inputs = yield* Ref.get(saved);
    assert.lengthOf(inputs, 1);
    assert.include(inputs[0], { threadId: null, threadMode: "new_thread" });
    assert.deepEqual(inputs[0]?.modelSelection, selection);
    assert.deepEqual(result.modelSelection, selection);
    assert.include(result, { boundThreadId: null, lastRunStatus: "never", nextRunAt: runAt });
    assert.equal(caller.modelSelection.model, "gpt-5");
  }),
);

it.effect("rejects invalid effort and a model override for a shared thread before saving", () =>
  Effect.gen(function* () {
    const saved = yield* Ref.make<ReadonlyArray<ScheduledTaskUpsertInput>>([]);
    const mcp = yield* OrchestratorMcpService.OrchestratorMcpService.pipe(
      Effect.provide(service(saved)),
    );
    const wrongEffort = decode({
      ...request,
      target: { providerInstanceId, model, options: { reasoningEffort: "invalid" } },
    });
    const optionError = yield* mcp.scheduleTask(scope, wrongEffort).pipe(Effect.flip);
    assert.include(optionError.message, "rejected options");
    const modeError = yield* mcp
      .scheduleTask(scope, { ...request, freshSession: true })
      .pipe(Effect.flip);
    assert.include(modeError.message, "needs a new thread per run");
    assert.deepEqual(yield* Ref.get(saved), []);
  }),
);
