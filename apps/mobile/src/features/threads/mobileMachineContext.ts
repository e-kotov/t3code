import type { EnvironmentMachineKind } from "@t3tools/contracts";

import {
  compareMachineOrder,
  type ThreadListV2MachineHeaderListItem,
} from "./conversationListOrder";
import { isThreadListV2ListItem } from "./threadListV2";

/** Keep machine status reachable when grouping is off or has only one machine. */
export function withMobileMachineContext<T extends { readonly type: string }>(
  items: readonly T[],
  environments: ReadonlyArray<{ readonly environmentId: string; readonly label: string }>,
  machineKinds: ReadonlyMap<string, EnvironmentMachineKind>,
  preferredOrder: readonly string[],
): readonly (T | ThreadListV2MachineHeaderListItem)[] {
  if (items.some((item) => item.type === "v2-machine-header")) return items;

  const ids = new Set<string>();
  for (const item of items) {
    if (!isThreadListV2ListItem(item)) continue;
    if (item.type === "v2-thread") ids.add(item.item.thread.environmentId);
    if (item.type === "v2-pending") ids.add(item.pendingTask.environmentId);
  }
  if (ids.size === 0) return items;

  const labels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const ordered = [...ids].sort(compareMachineOrder(preferredOrder));
  const headers: ThreadListV2MachineHeaderListItem[] = ordered.map((environmentId, position) => ({
    type: "v2-machine-header",
    key: `mobile-machine-context:${environmentId}`,
    environmentId,
    label: labels.get(environmentId) ?? "Machine",
    machineKind: machineKinds.get(environmentId) ?? "server",
    position,
    count: ordered.length,
  }));
  return [...headers, ...items];
}
