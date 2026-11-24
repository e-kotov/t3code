import type {
  MessageId,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  OrchestrationV2UserMessageInputIntent,
} from "@t3tools/contracts";
import { isIdleMaintenanceMessageId } from "./threadCachePolicy.ts";

type TimelineRun = Pick<OrchestrationV2Run, "status"> &
  Partial<Pick<OrchestrationV2Run, "startedAt">>;
type TimelineTurnItem = Pick<OrchestrationV2TurnItem, "type"> & {
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent;
  readonly messageId?: MessageId;
};

export type TimelineVisibilityStatus =
  | "rolled_back"
  | "queued"
  | "cancelled"
  | "cancelled_after_start";

export function isHiddenUserInput(
  item: TimelineTurnItem,
  status: TimelineVisibilityStatus | undefined,
) {
  return (
    item.type === "user_message" &&
    ((item.inputIntent === "queued_turn" && (status === "queued" || status === "cancelled")) ||
      ((status === "cancelled" || status === "cancelled_after_start") &&
        item.messageId !== undefined &&
        isIdleMaintenanceMessageId(item.messageId)))
  );
}

// A run that started received its queued input, even if recovery cancelled it later.
export function runVisibilityStatus(run: TimelineRun): TimelineVisibilityStatus | undefined {
  const status = run.status;
  if (status === "cancelled") {
    return run.startedAt == null ? "cancelled" : "cancelled_after_start";
  }
  return status === "rolled_back" || status === "queued" ? status : undefined;
}

export function isHidden(item: TimelineTurnItem, run: TimelineRun): boolean {
  const status = runVisibilityStatus(run);
  return status === "rolled_back" || isHiddenUserInput(item, status);
}
