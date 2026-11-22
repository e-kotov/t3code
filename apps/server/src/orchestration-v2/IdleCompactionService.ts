import {
  CommandId,
  IDLE_COMPACTION_TEXT,
  MessageId,
  resolveProjectProviderInstanceEnabled,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  MACHINE_IDLE_COMPACTION_MESSAGE_PREFIX,
  resolveThreadIdleCompaction,
} from "@t3tools/shared/threadCachePolicy";
import { watchThreadCachePolicies } from "./ThreadCachePolicyService.ts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { retryableCachePolicyRejection } from "./ThreadCachePolicyDispatch.ts";
import { idleCompactionWindow } from "./IdleCompaction.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;

  const compactWhenDue = Effect.fn("IdleCompactionService.compactWhenDue")(
    function* (threadId: ThreadId, completedRunId: RunId) {
      let runId = completedRunId;
      // Loops after the wait or a retarget: the thread may have moved on.
      while (true) {
        const current = yield* settings.getSettings;
        const thread = yield* projections.getThread(threadId);
        const claudeInstance = Object.hasOwn(current.providerInstances, thread.providerInstanceId)
          ? current.providerInstances[thread.providerInstanceId]?.driver === "claudeAgent"
          : thread.providerInstanceId === "claudeAgent";
        if (
          (current.machineIdlePolicy === undefined && !claudeInstance) ||
          resolveThreadIdleCompaction(current, threadId, thread.providerInstanceId) !==
            "beforeCacheExpires" ||
          !resolveProjectProviderInstanceEnabled(
            current,
            thread.projectId,
            thread.providerInstanceId,
          )
        )
          return;
        const activeProviderThreadIds =
          thread.activeProviderThreadId === null ? [] : [thread.activeProviderThreadId];
        const records = yield* projections.getThreadRecords(
          threadId,
          [
            "runs",
            "messages",
            "providerThreads",
            "providerTurns",
            "runtimeRequests",
            "turnItems",
            "contextTransfers",
          ],
          {
            messageRunIds: [runId],
            turnItemStatuses: ["pending", "running", "waiting"],
            // The latest run, active runs that hold background work, and rolled-back runs whose
            // items it ignores.
            runStatuses: ["preparing", "starting", "running", "rolled_back"],
            includeLatestRun: true,
            // Without an active provider thread there is no session to compact.
            providerThreadIds: activeProviderThreadIds,
            providerTurnThreadIds: activeProviderThreadIds,
            latestProviderTurnUsageOnly: true,
            runtimeRequestStatuses: ["pending"],
            contextTransferStatuses: ["pending"],
          },
        );
        if (
          resolveThreadIdleCompaction(current, threadId, records.thread.providerInstanceId) !==
            "beforeCacheExpires" ||
          !resolveProjectProviderInstanceEnabled(
            current,
            records.thread.projectId,
            records.thread.providerInstanceId,
          )
        )
          return;
        const latestRun = records.runs
          .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
          .reduce<(typeof records.runs)[number] | undefined>(
            (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
            undefined,
          );
        // A late update for an earlier run replaced the latest run's timer, so take it over.
        if (latestRun?.status === "completed" && latestRun.id !== runId) {
          runId = latestRun.id;
          continue;
        }
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        const window = idleCompactionWindow(records, nowMs, current.machineIdlePolicy);
        if (window?.runId !== runId) return;
        if (nowMs < window.startMs) {
          yield* Effect.sleep(Duration.millis(window.startMs - nowMs));
          continue;
        }
        const submission = yield* Effect.result(
          orchestrator.dispatch({
            type: "message.dispatch",
            // One compaction per completed run, even across duplicate events.
            commandId: CommandId.make(`server:idle-compact:${threadId}:${runId}`),
            messageId: MessageId.make(
              `${current.machineIdlePolicy === undefined ? "idle-compact:" : MACHINE_IDLE_COMPACTION_MESSAGE_PREFIX}${threadId}:${runId}`,
            ),
            threadId,
            text: IDLE_COMPACTION_TEXT,
            attachments: [],
            createdBy: "agent",
            creationSource: "server",
            idleCompaction: "beforeCacheExpires",
            dispatchMode: { type: "start_immediately" },
          }),
        );
        if (submission._tag === "Failure") {
          if (!retryableCachePolicyRejection(submission.failure)) return yield* submission.failure;
          const retryMs = Math.min(30_000, window.endMs - nowMs);
          if (retryMs <= 0) return;
          yield* Effect.sleep(Duration.millis(retryMs));
          continue;
        }
        return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("idle compaction skipped", { threadId, cause })),
      ),
  );

  const start = Effect.fn("IdleCompactionService.start")(function* () {
    // Keyed by thread: a newer completed run replaces the waiting timer.
    const timers = yield* FiberMap.make<ThreadId>();
    yield* watchThreadCachePolicies(timers, compactWhenDue);
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? FiberMap.run(timers, event.threadId, compactWhenDue(event.threadId, event.payload.id))
          : Effect.void,
      ),
    );
  });
  return { start };
});
