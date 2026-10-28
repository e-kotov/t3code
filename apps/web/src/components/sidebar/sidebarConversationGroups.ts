import { machineGroupThreadVisible } from "@t3tools/client-runtime/state/machine-group-collapse";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  SidebarConversationGrouping,
  SidebarConversationSortOrder,
} from "@t3tools/contracts/settings";

import { sortSidebarConversations } from "../../lib/threadSort";
import type { SidebarListItem, SidebarSection } from "../Sidebar.logic";

export interface SidebarConversationView {
  readonly sortOrder: SidebarConversationSortOrder;
  readonly grouping: SidebarConversationGrouping;
  readonly machineOrder: readonly EnvironmentId[];
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly collapsedMachineGroups?: readonly string[];
  readonly selectedThreadKey?: string | null;
}

/** What a machine-group header marker carries; upstream markers leave it unset. */
export interface SidebarMarkerFields {
  readonly key?: string;
  readonly environmentId?: EnvironmentId;
  readonly groupPosition?: number;
  readonly groupCount?: number;
}

/** The selected conversation order replaces the upstream shelf order it is
    given. The comparator is total, so the input order never shows through. */
export function withConversationSort(
  threads: readonly EnvironmentThreadShell[],
  view: Pick<SidebarConversationView, "sortOrder" | "grouping">,
): EnvironmentThreadShell[] {
  return sortSidebarConversations(threads, view.sortOrder, Date.now(), view.grouping);
}

/** Saved machine order first; machines never placed follow, primary first. */
function compareMachineGroups(
  view: Pick<SidebarConversationView, "machineOrder" | "primaryEnvironmentId">,
) {
  return (left: EnvironmentId, right: EnvironmentId) => {
    const leftRank = view.machineOrder.indexOf(left);
    const rightRank = view.machineOrder.indexOf(right);
    if (leftRank >= 0 || rightRank >= 0) {
      if (leftRank < 0) return 1;
      if (rightRank < 0) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    } else {
      if (left === view.primaryEnvironmentId) return -1;
      if (right === view.primaryEnvironmentId) return 1;
    }
    return left.localeCompare(right);
  };
}

function sidebarMachineGroups<T extends { readonly environmentId: EnvironmentId }>(
  list: readonly T[],
  view: Omit<SidebarConversationView, "sortOrder">,
): T[][] {
  if (view.grouping !== "machine") return [[...list]];
  const groups = new Map<EnvironmentId, T[]>();
  for (const thread of list) {
    const group = groups.get(thread.environmentId) ?? [];
    group.push(thread);
    groups.set(thread.environmentId, group);
  }
  return [...groups.keys()].sort(compareMachineGroups(view)).map((id) => groups.get(id)!);
}

export function visibleSidebarKeys<
  T extends { readonly environmentId: EnvironmentId; readonly id: string },
>(
  threads: readonly T[],
  sectionByThreadKey: ReadonlyMap<string, SidebarSection>,
  view: Omit<SidebarConversationView, "sortOrder">,
): string[] {
  const shelves = new Map<SidebarSection, T[]>();
  for (const thread of threads) {
    const section = sectionByThreadKey.get(`${thread.environmentId}:${thread.id}`);
    if (section === undefined) continue;
    const shelf = shelves.get(section) ?? [];
    shelf.push(thread);
    shelves.set(section, shelf);
  }
  return [...shelves.values()].flatMap((list) =>
    sidebarMachineGroups(list, view)
      .flatMap((group) => group.filter((thread) => machineGroupThreadVisible(thread, view)))
      .map((thread) => `${thread.environmentId}:${thread.id}`),
  );
}

export function groupSidebarRowsByMachine<
  T extends { readonly environmentId: EnvironmentId; readonly id: string },
>(
  list: readonly T[],
  section: SidebarSection,
  view: Omit<SidebarConversationView, "sortOrder">,
  rowsOf: (list: readonly T[], section: SidebarSection) => SidebarListItem[],
): SidebarListItem[] {
  if (view.grouping !== "machine") return rowsOf(list, section);
  const groups = sidebarMachineGroups(list, view);
  return groups.flatMap((group, groupPosition): SidebarListItem[] => [
    {
      kind: "marker",
      marker: "machine-header",
      key: `sidebar-machine:${section}:${group[0]!.environmentId}`,
      environmentId: group[0]!.environmentId,
      groupPosition,
      groupCount: groups.length,
    },
    ...rowsOf(
      group.filter((thread) => machineGroupThreadVisible(thread, view)),
      section,
    ),
  ]);
}

/** The machine order to save after moving one machine a step, or null at an edge. */
export function moveMachineGroup(
  environmentIds: Iterable<EnvironmentId>,
  view: Pick<SidebarConversationView, "machineOrder" | "primaryEnvironmentId">,
  environmentId: EnvironmentId,
  delta: -1 | 1,
): EnvironmentId[] | null {
  const visibleIds = [...new Set(environmentIds)].sort(compareMachineGroups(view));
  const index = visibleIds.indexOf(environmentId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= visibleIds.length) return null;
  [visibleIds[index], visibleIds[target]] = [visibleIds[target]!, visibleIds[index]!];
  return visibleIds;
}
