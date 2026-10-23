import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2ThreadProjection,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { unsafeCacheWarmingDispatch } from "./CacheWarmingDispatchGuard.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for idle-only dispatch checks"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "cache-warming-dispatch" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

function createThread(threadId: ThreadId) {
  return {
    type: "thread.create" as const,
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: "Cache warm test",
    modelSelection,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    createdBy: "user" as const,
    creationSource: "web" as const,
  };
}

function warmCommand(threadId: ThreadId, commandKey: string, model = modelSelection) {
  return {
    type: "message.dispatch" as const,
    commandId: CommandId.make(commandKey),
    threadId,
    messageId: MessageId.make(`${commandKey}:message`),
    text: "Cache warm check only: do not use tools or inspect or change anything. Reply with exactly: cache warm.",
    attachments: [],
    dispatchMode: { type: "start_if_idle" as const },
    modelSelection: model,
    expectedActiveProviderThreadId: null,
    createdBy: "system" as const,
    creationSource: "server" as const,
  };
}

it.effect(
  "starts one visible warm turn only when serialized state still matches the idle snapshot",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:cache-warm-idle-only");
      yield* orchestrator.dispatch(createThread(threadId));

      const accepted = yield* orchestrator.dispatch(warmCommand(threadId, "cache-warm-accepted"));
      assert.isAbove(accepted.storedEvents.length, 0);
      const projection = yield* projections.getThreadProjection(threadId);
      const message = projection.messages.find(
        (candidate) => candidate.id === MessageId.make("cache-warm-accepted:message"),
      );
      assert.equal(message?.createdBy, "system");
      assert.equal(message?.creationSource, "server");
      assert.include(message?.text ?? "", "Reply with exactly: cache warm.");

      // The same idle snapshot is stale after the first accepted turn. The second
      // call uses a new command id so this assertion exercises the serialized gate.
      const activeRace = yield* Effect.exit(
        orchestrator.dispatch(warmCommand(threadId, "cache-warm-active-race")),
      );
      assert.equal(activeRace._tag, "Failure");
      const afterRejection = yield* projections.getThreadProjection(threadId);
      assert.deepEqual(afterRejection.messages, projection.messages);
      assert.deepEqual(afterRejection.runs, projection.runs);

      const switchedThread = ThreadId.make("thread:cache-warm-model-race");
      yield* orchestrator.dispatch(createThread(switchedThread));
      const modelRace = yield* Effect.exit(
        orchestrator.dispatch(
          warmCommand(switchedThread, "cache-warm-model-race", {
            ...modelSelection,
            model: "stale-model-selection",
          }),
        ),
      );
      assert.equal(modelRace._tag, "Failure");

      const providerRace = yield* Effect.exit(
        orchestrator.dispatch({
          ...warmCommand(switchedThread, "cache-warm-provider-race"),
          expectedActiveProviderThreadId: ProviderThreadId.make("stale-provider-thread"),
        }),
      );
      assert.equal(providerRace._tag, "Failure");
      assert.isEmpty((yield* projections.getThreadProjection(switchedThread)).messages);

      const archivedThread = ThreadId.make("thread:cache-warm-archived-race");
      yield* orchestrator.dispatch(createThread(archivedThread));
      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("cache-warm-archive"),
        threadId: archivedThread,
      });
      const archivedRace = yield* Effect.exit(
        orchestrator.dispatch(warmCommand(archivedThread, "cache-warm-archived-race")),
      );
      assert.equal(archivedRace._tag, "Failure");
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "rechecks queued runs, run failures and background work from the current projection",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:cache-warm-projection-guard");
      yield* orchestrator.dispatch(createThread(threadId));
      yield* orchestrator.dispatch(warmCommand(threadId, "cache-warm-projection-fixture"));
      const projection = yield* projections.getThreadProjection(threadId);
      const run = projection.runs[0]!;
      const item = projection.turnItems[0]!;
      const now = DateTime.makeUnsafe(0);
      const completedRun = { ...run, status: "completed" as const, completedAt: now };
      const idle = { ...projection, runs: [completedRun] };
      const rejects = (current: OrchestrationV2ThreadProjection) =>
        unsafeCacheWarmingDispatch({
          projection: current,
          command: warmCommand(threadId, "cache-warm-projection-recheck"),
          activeRun: undefined,
        });
      assert.isFalse(rejects(idle));
      assert.isTrue(rejects({ ...idle, runs: [{ ...completedRun, status: "failed" }] }));
      assert.isTrue(rejects({ ...idle, runs: [{ ...completedRun, status: "interrupted" }] }));
      assert.isTrue(rejects({ ...idle, runs: [{ ...completedRun, status: "queued" }] }));

      const background = {
        ...item,
        type: "command_execution" as const,
        input: "background work",
        status: "running" as const,
        runId: run.id,
      };
      assert.isTrue(rejects({ ...idle, turnItems: [background] }));
      // Upstream excludes rolled-back work from its pending-work policy.
      assert.isFalse(
        rejects({
          ...idle,
          runs: [{ ...completedRun, status: "rolled_back" }],
          turnItems: [background],
        }),
      );
    }).pipe(Effect.provide(layerTest)),
);
