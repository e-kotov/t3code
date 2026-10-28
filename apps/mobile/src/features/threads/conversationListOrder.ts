import { sortSidebarConversations } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentMachineKind,
  SidebarConversationGrouping,
  SidebarConversationSortOrder,
} from "@t3tools/contracts";

/** Fork conversation sort options accepted by `buildThreadListV2Items`. */
export interface ConversationShelfSortInput {
  /** User-selected sort for the visible Working and Active shelves. */
  readonly conversationSortOrder?: SidebarConversationSortOrder;
  readonly conversationGrouping?: SidebarConversationGrouping;
}

export interface ThreadListV2MachineHeaderListItem {
  readonly type: "v2-machine-header";
  readonly key: string;
  readonly label: string;
  readonly environmentId: string;
  readonly position: number;
  readonly count: number;
  readonly machineKind?: EnvironmentMachineKind;
  readonly collapsible?: boolean;
}

/**
 * Applies the selected conversation sort to an already ordered Working or
 * Active shelf. Without a selected order the upstream saved, pending-move and
 * inbox ordering is kept as is. Pinned, snoozed and settled shelves never pass
 * through here.
 */
export function sortConversationShelf<T extends EnvironmentThreadShell>(
  input: ConversationShelfSortInput,
  threads: T[],
): T[] {
  return input.conversationSortOrder === undefined
    ? threads
    : sortSidebarConversations(
        threads,
        input.conversationSortOrder,
        Date.now(),
        input.conversationGrouping ?? "none",
      );
}

export function machineHeadersAreEqual(
  previous: { readonly type: string },
  item: ThreadListV2MachineHeaderListItem,
): boolean {
  if (previous.type !== item.type) return false;
  const header = previous as ThreadListV2MachineHeaderListItem;
  return (
    header.key === item.key &&
    header.label === item.label &&
    header.environmentId === item.environmentId &&
    header.position === item.position &&
    header.count === item.count &&
    header.machineKind === item.machineKind &&
    header.collapsible === item.collapsible
  );
}

/** Saved machines first in their saved order; the rest alphabetically by id. */
export function compareMachineOrder(preferredOrder: readonly string[]) {
  return (left: string, right: string) => {
    const a = preferredOrder.indexOf(left);
    const b = preferredOrder.indexOf(right);
    return (
      (a < 0 ? Number.MAX_SAFE_INTEGER : a) - (b < 0 ? Number.MAX_SAFE_INTEGER : b) ||
      left.localeCompare(right)
    );
  };
}

/** The full machine order after moving one machine group up or down, or null at an edge. */
export function moveMachineInOrder(
  environmentIds: readonly string[],
  preferredOrder: readonly string[],
  environmentId: string,
  delta: -1 | 1,
): string[] | null {
  const ordered = [...new Set(environmentIds)].sort(compareMachineOrder(preferredOrder));
  const index = ordered.indexOf(environmentId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return null;
  [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
  return ordered;
}
