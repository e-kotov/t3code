import type { RunId, ThreadId } from "@t3tools/contracts";
import { resolveThreadIdleCompaction } from "@t3tools/shared/threadCachePolicy";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Stream from "effect/Stream";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/** Arm existing idle threads when policy changes, including after a server restart. */
export const watchThreadCachePolicies = Effect.fn("ThreadCachePolicyService.watch")(function* (
  timers: FiberMap.FiberMap<ThreadId>,
  compact: (threadId: ThreadId, runId: RunId) => Effect.Effect<void>,
) {
  const settings = yield* ServerSettings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const changes = yield* settings.subscribeChanges;
  let previousKey: string | undefined;
  const refresh = Effect.fn("ThreadCachePolicyService.refresh")(
    function* () {
      const current = yield* settings.getSettings;
      const key = JSON.stringify([
        current.threadCachePolicies,
        current.cacheWarmingSessions,
        current.idleCompaction,
        current.compactIdleThreads,
        current.providerInstances,
        current.projectSettingsOverrides,
      ]);
      if (key === previousKey) return;
      const snapshot = yield* projections.getShellSnapshot({ location: "active" });
      previousKey = key;
      for (const thread of snapshot.threads) {
        if (
          resolveThreadIdleCompaction(current, thread.id, thread.modelSelection.instanceId) !==
          "beforeCacheExpires"
        ) {
          yield* FiberMap.remove(timers, thread.id);
        } else if (thread.latestRunId !== null && thread.activeRunId === null) {
          yield* FiberMap.run(timers, thread.id, compact(thread.id, thread.latestRunId));
        }
      }
    },
    Effect.catch((cause) => Effect.logWarning("Refreshing idle cache policies failed", { cause })),
  );
  yield* forkParked(refresh().pipe(Effect.andThen(Stream.runForEach(changes, refresh))));
});
