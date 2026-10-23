import type {
  OrchestrationV2Command,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import { pendingBackgroundTurnItems } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

/** Recheck the warmer's snapshot inside serialized dispatch, after other commands ran. */
export function unsafeCacheWarmingDispatch({
  projection,
  command,
  activeRun,
}: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly command: Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
  readonly activeRun: OrchestrationV2Run | undefined;
}): boolean {
  const latestRun = latestExecutedRun(projection.runs);
  return (
    activeRun !== undefined ||
    projection.thread.settledOverride === "settled" ||
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
