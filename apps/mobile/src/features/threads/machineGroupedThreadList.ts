import { hasWorkingDivider, placeWorkingMainDivider } from "./workingSidebarList";
import {
  machineGroupThreadVisible,
  type MachineGroupSection,
} from "@t3tools/client-runtime/state/machine-group-collapse";
import {
  isSidebarMachineGrouping,
  type EnvironmentMachineKind,
  type SidebarConversationGrouping,
} from "@t3tools/contracts";

import {
  compareMachineOrder,
  type ThreadListV2MachineHeaderListItem,
} from "./conversationListOrder";
import { withMobileMachineContext } from "./mobileMachineContext";
import type { ThreadListV2ThreadListItem } from "./threadListV2";

function isMachineHeader(item: {
  readonly type: string;
}): item is ThreadListV2MachineHeaderListItem {
  return item.type === "v2-machine-header";
}

function isThreadRow<T extends { readonly type: string }>(
  item: T,
): item is T & ThreadListV2ThreadListItem {
  return item.type === "v2-thread";
}

/**
 * Splits each run of thread rows into machine sections in the saved machine
 * order. Every other row (shelf headers, pending tasks, trailing rows) stays in
 * place, including when only one machine has rows.
 */
export function groupThreadListV2ItemsByMachine<T extends { readonly type: string }>(
  items: readonly T[],
  labels: ReadonlyMap<string, string>,
  preferredOrder: readonly string[] = [],
  machineKinds: ReadonlyMap<string, EnvironmentMachineKind> = new Map(),
): (T | ThreadListV2MachineHeaderListItem)[] {
  const environmentIds = [
    ...new Set(
      items
        .filter((item): item is T & ThreadListV2ThreadListItem => isThreadRow(item))
        .map((item) => item.item.thread.environmentId),
    ),
  ].sort(compareMachineOrder(preferredOrder));
  const grouped: (T | ThreadListV2MachineHeaderListItem)[] = [];
  let index = 0;
  let shelf: MachineGroupSection = "active";
  let cursor = 0;
  while (cursor < items.length) {
    const item = items[cursor]!;
    if (isThreadRow(item) && "workingMain" in item && item.workingMain === true) shelf = "active";
    else if (item.type === "v2-working-shelf") shelf = "working";
    else if (item.type === "v2-snoozed-shelf") shelf = "snoozed";
    else if (item.type === "v2-settled-shelf") shelf = "settled";
    if (!isThreadRow(item)) {
      grouped.push(item);
      cursor += 1;
      continue;
    }
    const segment: (T & ThreadListV2ThreadListItem)[] = [];
    let row = items[cursor];
    // Pinned and main rows can follow another section without an upstream shelf header.
    while (
      row !== undefined &&
      isThreadRow(row) &&
      row.item.pinned === item.item.pinned &&
      (segment.length === 0 || !hasWorkingDivider(row))
    ) {
      segment.push(row);
      cursor += 1;
      row = items[cursor];
    }
    const section = item.item.pinned ? "pinned" : shelf;
    const groupedRows = new Map<string, T[]>();
    for (const threadRow of segment) {
      const id = threadRow.item.thread.environmentId;
      groupedRows.set(id, [...(groupedRows.get(id) ?? []), threadRow]);
    }
    const segmentEnvironmentIds = environmentIds.filter((id) => groupedRows.has(id));
    for (const [position, environmentId] of segmentEnvironmentIds.entries()) {
      grouped.push({
        type: "v2-machine-header",
        key: `v2-machine:${index++}:${environmentId}`,
        label: labels.get(environmentId) ?? "Machine",
        environmentId,
        position,
        count: segmentEnvironmentIds.length,
        machineKind: machineKinds.get(environmentId),
        section,
      });
      grouped.push(...(groupedRows.get(environmentId) ?? []));
    }
  }
  return grouped;
}

/**
 * The thread list as the Home screen and sidebar show it: machine sections when
 * grouping by machine, plus a machine summary whenever no section header is shown.
 * Always returns a fresh array.
 */
export function arrangeMobileConversationList<T extends { readonly type: string }>(
  items: readonly T[],
  options: {
    readonly grouping: SidebarConversationGrouping;
    readonly environments: ReadonlyArray<{
      readonly environmentId: string;
      readonly label: string;
    }>;
    readonly machineKinds: ReadonlyMap<string, EnvironmentMachineKind>;
    readonly machineOrder: readonly string[];
    readonly collapsedMachineGroups?: readonly string[];
    readonly selectedThreadKey?: string | null;
    readonly searchQuery?: string;
  },
): (T | ThreadListV2MachineHeaderListItem)[] {
  const arranged = isSidebarMachineGrouping(options.grouping)
    ? groupThreadListV2ItemsByMachine(
        items,
        new Map(
          options.environments.map((environment) => [
            String(environment.environmentId),
            environment.label,
          ]),
        ),
        options.machineOrder,
        options.machineKinds,
      )
    : items;
  const withContext = withMobileMachineContext(
    arranged,
    options.environments,
    options.machineKinds,
    options.machineOrder,
  );
  let section: MachineGroupSection = "active";
  return placeWorkingMainDivider(
    withContext.flatMap((item): (T | ThreadListV2MachineHeaderListItem)[] => {
      if (isMachineHeader(item)) {
        section = item.section ?? "active";
        return [
          {
            ...item,
            collapsible: isSidebarMachineGrouping(options.grouping) && !options.searchQuery?.trim(),
          },
        ];
      }
      if (
        isThreadRow(item) &&
        !machineGroupThreadVisible(item.item.thread, { ...options, section })
      ) {
        return [];
      }
      return [item];
    }),
  );
}
