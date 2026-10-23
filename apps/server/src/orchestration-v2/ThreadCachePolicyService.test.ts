import { assert, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId, ProviderInstanceId, RunId, ThreadId, type OrchestrationV2ThreadShell, type ServerSettings as Settings } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { watchThreadCachePolicies } from "./ThreadCachePolicyService.ts";

it.effect("arms an existing completed thread on startup, cancels its timer on Off and rearms when Compact is chosen", () => Effect.scoped(Effect.gen(function* () {
  const threadId = ThreadId.make("existing-idle-thread");
  const runId = RunId.make("completed-run");
  const now = DateTime.makeUnsafe(0);
  const shell: OrchestrationV2ThreadShell = {
    id: threadId, projectId: ProjectId.make("project"), title: "Idle", providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-5-5" }, runtimeMode: "full-access", interactionMode: "default",
    createdBy: "user", creationSource: "web", branch: null, worktreePath: null, lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null, activeProviderThreadId: null, latestRunId: runId, activeRunId: null, status: "completed", pendingRuntimeRequest: null,
    latestVisibleMessage: null, latestUserMessageAt: now, hasActionableProposedPlan: false, pendingBackgroundTasks: [], providerInstanceHistory: [], itemCount: 0, visibleItemCount: 0,
    createdAt: now, updatedAt: now, archivedAt: null, settledOverride: null, settledAt: null, deletedAt: null,
  };
  const current = yield* Ref.make(applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { idleCompaction: "off", threadCachePolicies: { [threadId]: "compact" } }));
  const changes = yield* PubSub.unbounded<Settings>();
  const started = yield* Queue.unbounded<RunId>();
  const cancelled = yield* Queue.unbounded<RunId>();
  const compact = (_threadId: ThreadId, id: RunId) => Queue.offer(started, id).pipe(Effect.andThen(Effect.never), Effect.ensuring(Queue.offer(cancelled, id)));
  const settingsLayer = Layer.mock(ServerSettings.ServerSettingsService)({
    getSettings: Ref.get(current),
    subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
  });
  const projectionLayer = Layer.mock(ProjectionStore.ProjectionStoreV2)({
    getShellSnapshot: () => Effect.succeed({ schemaVersion: 1, snapshotSequence: 0, threads: [shell], archivedThreads: [] }),
  });
  const timers = yield* FiberMap.make<ThreadId>();
  yield* watchThreadCachePolicies(timers, compact).pipe(Effect.provide(Layer.merge(settingsLayer, projectionLayer)));
  assert.equal(yield* Queue.take(started), runId);
  for (const policy of ["off", "warm", "compact"] as const) {
    const next = yield* Ref.updateAndGet(current, (settings) => applyServerSettingsPatch(settings, { threadCachePolicies: { [threadId]: policy } }));
    yield* PubSub.publish(changes, next);
    if (policy === "off") assert.equal(yield* Queue.take(cancelled), runId);
    if (policy === "compact") assert.equal(yield* Queue.take(started), runId);
  }
}))); 
