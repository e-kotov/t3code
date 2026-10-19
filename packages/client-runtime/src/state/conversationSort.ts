import type {
  SidebarConversationGrouping,
  SidebarConversationSortOrder,
} from "@t3tools/contracts/settings";
import type { EnvironmentThreadShell } from "./models.ts";
import { getThreadSortTimestamp, toSortableTimestamp, type ThreadSortInput } from "./threadSort.ts";

/** Sorts the visible Working/Active shelves. Cache expiry is a live estimate:
    known, still-hot deadlines lead earliest-first; cold or unknown rows follow
    by recent user activity. */
export function sortSidebarConversations<
  T extends ThreadSortInput & {
    readonly id: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly cacheHud?: EnvironmentThreadShell["cacheHud"];
    readonly environmentId?: string;
  },
>(
  threads: readonly T[],
  order: SidebarConversationSortOrder,
  nowMs: number,
  grouping: SidebarConversationGrouping = "none",
): T[] {
  const identity = (left: T, right: T) =>
    left.id.localeCompare(right.id) ||
    (left.environmentId ?? "").localeCompare(right.environmentId ?? "");
  const activity = (thread: T) =>
    getThreadSortTimestamp(thread, "updated_at") || toSortableTimestamp(thread.updatedAt) || 0;
  return [...threads].sort((left, right) => {
    if (grouping === "machine") {
      const groupOrder = (left.environmentId ?? "").localeCompare(right.environmentId ?? "");
      if (groupOrder !== 0) return groupOrder;
    }
    if (order === "created_at") {
      return (
        (toSortableTimestamp(right.createdAt) ?? 0) - (toSortableTimestamp(left.createdAt) ?? 0) ||
        identity(left, right)
      );
    }
    if (order === "cache_expiry") {
      const deadline = (thread: T) => {
        const hud = thread.cacheHud;
        if (
          !hud ||
          hud.ttlMs === undefined ||
          ((hud.usage.cachedInputTokens ?? 0) <= 0 && (hud.usage.cacheCreationTokens ?? 0) <= 0)
        )
          return null;
        const expiry = Date.parse(hud.usage.updatedAt) + hud.ttlMs;
        return Number.isFinite(expiry) && expiry > nowMs ? expiry : null;
      };
      const leftExpiry = deadline(left);
      const rightExpiry = deadline(right);
      if (leftExpiry !== null || rightExpiry !== null) {
        if (leftExpiry === null) return 1;
        if (rightExpiry === null) return -1;
        if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
      }
    }
    return activity(right) - activity(left) || identity(left, right);
  });
}
