import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { machineGroupThreadVisible } from "@t3tools/client-runtime/state/machine-group-collapse";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  SidebarConversationGrouping,
  SidebarConversationSortOrder,
} from "@t3tools/contracts/settings";

import { sortSidebarConversations } from "@t3tools/client-runtime/state/thread-sort";
import type { SidebarListItem, SidebarSection } from "../Sidebar.logic";

export interface SidebarConversationView {
  readonly sortOrder: SidebarConversationSortOrder;
  readonly grouping: SidebarConversationGrouping;
  readonly machineOrder: readonly EnvironmentId[];
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly collapsedMachineGroups?: readonly string[];
  readonly collapsedProjectFolders?: readonly string[];
  readonly selectedThreadKey?: string | null;
}

/** What a machine-group or project-folder header marker carries; upstream markers leave it unset. */
export interface SidebarMarkerFields {
  readonly key?: string;
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly projectKey?: string;
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
  T extends Pick<EnvironmentThreadShell, "environmentId" | "id"> & {
    readonly projectId?: ProjectId | null | undefined;
  },
>(
  threads: readonly T[],
  sectionByThreadKey: ReadonlyMap<string, SidebarSection>,
  view: Omit<SidebarConversationView, "sortOrder">,
): string[] {
  const shelves = new Map<SidebarSection, T[]>();
  for (const thread of threads) {
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const section = sectionByThreadKey.get(key);
    if (section === undefined) continue;
    const shelf = shelves.get(section) ?? [];
    shelf.push(thread);
    shelves.set(section, shelf);
  }
  return [...shelves.entries()].flatMap(([section, list]) =>
    sidebarMachineGroups(list, view).flatMap((group) => {
      const visible = group.filter((thread) => machineGroupThreadVisible(thread, view));
      if (section !== "active") {
        return visible.map((t) => scopedThreadKey(scopeThreadRef(t.environmentId, t.id)));
      }
      return visible
        .filter((thread) => {
          if (!thread.projectId) return true;
          const pKey = String(thread.projectId);
          const folderKey = `sidebar-project:${thread.environmentId}:${pKey}`;
          const isCollapsed = view.collapsedProjectFolders?.includes(folderKey) ?? false;
          if (!isCollapsed) return true;
          const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          return view.selectedThreadKey === threadKey;
        })
        .map((t) => scopedThreadKey(scopeThreadRef(t.environmentId, t.id)));
    }),
  );
}

export function groupSidebarRowsByMachine<
  T extends Pick<EnvironmentThreadShell, "environmentId" | "id"> & {
    readonly projectId?: ProjectId | null | undefined;
  },
>(
  list: readonly T[],
  section: SidebarSection,
  view: Omit<SidebarConversationView, "sortOrder">,
  rowsOf: (list: readonly T[], section: SidebarSection, folderRow?: string) => SidebarListItem[],
): SidebarListItem[] {
  if (view.grouping !== "machine") return rowsOf(list, section);
  const groups = sidebarMachineGroups(list, view);
  return groups.flatMap((group, groupPosition): SidebarListItem[] => {
    const machineHeader: SidebarListItem = {
      kind: "marker",
      marker: "machine-header",
      key: `sidebar-machine:${section}:${group[0]!.environmentId}`,
      environmentId: group[0]!.environmentId,
      groupPosition,
      groupCount: groups.length,
    };

    const visibleThreads = group.filter((thread) => machineGroupThreadVisible(thread, view));

    if (section !== "active") {
      return [machineHeader, ...rowsOf(visibleThreads, section)];
    }

    // Active shelf: group by project under each machine
    const projectBuckets = new Map<string, T[]>();
    const looseThreads: T[] = [];
    for (const thread of visibleThreads) {
      if (thread.projectId) {
        const pKey = String(thread.projectId);
        const bucket = projectBuckets.get(pKey) ?? [];
        bucket.push(thread);
        projectBuckets.set(pKey, bucket);
      } else {
        looseThreads.push(thread);
      }
    }

    const items: SidebarListItem[] = [machineHeader];
    for (const [pKey, threadsInProject] of projectBuckets.entries()) {
      const folderKey = `sidebar-project:${group[0]!.environmentId}:${pKey}`;
      const isCollapsed = view.collapsedProjectFolders?.includes(folderKey) ?? false;

      items.push({
        kind: "marker",
        marker: "project-header",
        key: folderKey,
        environmentId: group[0]!.environmentId,
        projectId: pKey as ProjectId,
        projectKey: pKey,
        groupCount: threadsInProject.length,
      });

      const threadsToRender = isCollapsed
        ? threadsInProject.filter((t) => {
            const threadKey = scopedThreadKey(scopeThreadRef(t.environmentId, t.id));
            return view.selectedThreadKey === threadKey;
          })
        : threadsInProject;

      items.push(...rowsOf(threadsToRender, section, folderKey));
    }

    if (looseThreads.length > 0) {
      items.push(...rowsOf(looseThreads, section));
    }

    return items;
  });
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
