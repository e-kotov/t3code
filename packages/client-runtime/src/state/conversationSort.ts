import type {
  SidebarConversationGrouping,
  SidebarConversationSortOrder,
} from "@t3tools/contracts/settings";
import type { EnvironmentThreadShell } from "./models.ts";
import { getThreadSortTimestamp, toSortableTimestamp, type ThreadSortInput } from "./threadSort.ts";

export type SidebarConversationSortCriterion = "updated_at" | "created_at" | "cache_expiry";

const REVERSED_SORT_ORDER: Readonly<
  Record<SidebarConversationSortCriterion, SidebarConversationSortOrder>
> = {
  updated_at: "updated_at_reversed",
  created_at: "created_at_reversed",
  cache_expiry: "cache_expiry_reversed",
};

export function getSidebarConversationSortCriterion(
  order: SidebarConversationSortOrder,
): SidebarConversationSortCriterion {
  return order.replace("_reversed", "") as SidebarConversationSortCriterion;
}

export function isSidebarConversationSortReversed(order: SidebarConversationSortOrder): boolean {
  return order.endsWith("_reversed");
}

export function selectSidebarConversationSortOrder(
  current: SidebarConversationSortOrder,
  criterion: SidebarConversationSortCriterion,
): SidebarConversationSortOrder {
  if (getSidebarConversationSortCriterion(current) !== criterion) return criterion;
  return isSidebarConversationSortReversed(current) ? criterion : REVERSED_SORT_ORDER[criterion];
}

/** Sorts the visible Working/Active shelves. Reversed variants invert the whole order.
    Cache expiry uses live deadlines, then falls back to recent user activity. */
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
  const direction = isSidebarConversationSortReversed(order) ? -1 : 1;
  const criterion = getSidebarConversationSortCriterion(order);
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
    if (criterion === "created_at") {
      const createdAtOrder =
        (toSortableTimestamp(right.createdAt) ?? 0) - (toSortableTimestamp(left.createdAt) ?? 0);
      return direction * createdAtOrder || identity(left, right);
    }
    if (criterion === "cache_expiry") {
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
        if (leftExpiry === null) return direction;
        if (rightExpiry === null) return -direction;
        if (leftExpiry !== rightExpiry) return direction * (leftExpiry - rightExpiry);
      }
    }
    return direction * (activity(right) - activity(left)) || identity(left, right);
  });
}
