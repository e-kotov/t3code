import type { EnvironmentMachineKind, SidebarConversationGrouping } from "@t3tools/contracts";

import {
  compareMachineOrder,
  type ThreadListV2MachineHeaderListItem,
} from "./conversationListOrder";
import { withMobileMachineContext } from "./mobileMachineContext";
import type { ThreadListV2ThreadListItem } from "./threadListV2";

function isThreadRow<T extends { readonly type: string }>(
  item: T,
): item is T & ThreadListV2ThreadListItem {
  return item.type === "v2-thread";
}

/**
 * Splits each run of thread rows into machine sections in the saved machine
 * order. Every other row (shelf headers, pending tasks, trailing rows) stays in
 * place, and a list with at most one machine is returned without sections.
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
  if (environmentIds.length <= 1) return [...items];
  const grouped: (T | ThreadListV2MachineHeaderListItem)[] = [];
  let index = 0;
  let cursor = 0;
  while (cursor < items.length) {
    const item = items[cursor]!;
    if (!isThreadRow(item)) {
      grouped.push(item);
      cursor += 1;
      continue;
    }
    const segment: (T & ThreadListV2ThreadListItem)[] = [];
    let row = items[cursor];
    // Pinned and active rows can be adjacent without an upstream shelf header.
    while (row !== undefined && isThreadRow(row) && row.item.pinned === item.item.pinned) {
      segment.push(row);
      cursor += 1;
      row = items[cursor];
    }
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
  },
): (T | ThreadListV2MachineHeaderListItem)[] {
  const arranged =
    options.grouping === "machine"
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
  return [
    ...withMobileMachineContext(
      arranged,
      options.environments,
      options.machineKinds,
      options.machineOrder,
    ),
  ];
}
