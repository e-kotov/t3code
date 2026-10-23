import type {
  OrchestrationV2Command,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import { pendingBackgroundTurnItems } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

/**
 * Settling or snoozing a thread retires its warming opt-in: the sweep turns it
 * off, so un-settling or waking later does not resume warming on its own.
 */
export function cacheWarmingRetired(
  thread: Pick<OrchestrationV2ThreadShell, "settledOverride" | "snoozedUntil">,
  nowMs: number,
): boolean {
  return (
    thread.settledOverride === "settled" ||
    (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
  );
}

/**
 * Recheck the warmer's snapshot inside serialized dispatch, after other commands ran. Message
 * dispatch unsettles and unsnoozes the thread before it starts a run, so this must see the
 * projection as the command found it.
 */
export function unsafeCacheWarmingDispatch({
  projection,
  command,
  activeRun,
  nowMs,
}: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly command: Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
  readonly activeRun: OrchestrationV2Run | undefined;
  readonly nowMs: number;
}): boolean {
  const latestRun = latestExecutedRun(projection.runs);
  return (
    activeRun !== undefined ||
    cacheWarmingRetired(projection.thread, nowMs) ||
    projection.runs.some((run) => run.status === "queued") ||
    projection.thread.archivedAt !== null ||
    projection.thread.deletedAt !== null ||
    projection.thread.limitRecovery != null ||
    projection.runtimeRequests.some((request) => request.status === "pending") ||
    projection.providerThreads.some(
      (providerThread) => (providerThread.pendingBackgroundTasks?.length ?? 0) > 0,
    ) ||
    pendingBackgroundTurnItems(projection).length > 0 ||
    latestRootProviderFailure(latestRun, projection.turnItems) !== null ||
    latestRun?.status === "failed" ||
    latestRun?.status === "interrupted" ||
    (command.expectedActiveProviderThreadId !== undefined &&
      command.expectedActiveProviderThreadId !== projection.thread.activeProviderThreadId) ||
    (command.modelSelection !== undefined &&
      !modelSelectionsEqual(command.modelSelection, projection.thread.modelSelection))
  );
}
