import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { sidebarListItemId, animateSidebarLayoutChanges } from "../Sidebar.logic";
import { SIDEBAR_SORTABLE_DRAG_DISABLED } from "./SidebarThreadRow";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { useEnvironmentMachines, usePrimaryEnvironmentId } from "../../state/environments";
import { CacheWarmingMachineToggle } from "../CacheWarmingToggle";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { MachineGroupConnectionStatus } from "../MachineGroupConnectionStatus";
import { MachineGroupSlurmTime } from "../MachineGroupSlurmTime";
import type { SidebarListItem } from "../Sidebar.logic";
import { moveMachineGroup, type SidebarConversationView } from "./sidebarConversationGroups";

export function useSidebarConversationView(): SidebarConversationView {
  const sortOrder = useClientSettings((s) => s.sidebarConversationSortOrder);
  const grouping = useClientSettings((s) => s.sidebarConversationGrouping);
  const machineOrder = useClientSettings((s) => s.sidebarConversationMachineOrder);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return { sortOrder, grouping, machineOrder, primaryEnvironmentId };
}

export function SidebarMachineGroupHeader(props: {
  readonly item: Extract<SidebarListItem, { kind: "marker" }>;
  readonly labelById: ReadonlyMap<EnvironmentId, string>;
  /** All sidebar threads: moving a machine reorders every machine that has rows. */
  readonly threads: readonly EnvironmentThreadShell[];
}) {
  const { environmentId, groupPosition, groupCount } = props.item;
  const view = useSidebarConversationView();
  const machineById = useEnvironmentMachines();
  const move = (delta: -1 | 1) => {
    if (!environmentId) return;
    const order = moveMachineGroup(
      props.threads.map((thread) => thread.environmentId),
      view,
      environmentId,
      delta,
    );
    if (order) void updateClientSettings({ sidebarConversationMachineOrder: order });
  };
  return (
    <div className="mx-2 mt-2 flex items-center gap-1 border-t border-sidebar-border/60 pt-2 text-3xs font-medium uppercase tracking-wide text-sidebar-muted-foreground/70">
      {environmentId ? <MachineGroupConnectionStatus environmentId={environmentId} /> : null}
      {environmentId ? (
        <EnvironmentMachineIcon
          kind={machineById.get(environmentId) ?? "server"}
          className="size-3 shrink-0"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        {environmentId ? (props.labelById.get(environmentId) ?? "Machine") : "Machine"}
        {environmentId ? <MachineGroupSlurmTime environmentId={environmentId} /> : null}
      </span>
      {environmentId ? (
        <CacheWarmingMachineToggle environmentId={environmentId} threads={props.threads} />
      ) : null}
      {environmentId && groupPosition !== undefined && groupCount !== undefined ? (
        <span className="flex shrink-0">
          <button
            type="button"
            aria-label="Move machine group up"
            disabled={groupPosition === 0}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
            onClick={(event) => {
              event.stopPropagation();
              move(-1);
            }}
          >
            <ArrowUpIcon className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Move machine group down"
            disabled={groupPosition === groupCount - 1}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
            onClick={(event) => {
              event.stopPropagation();
              move(1);
            }}
          >
            <ArrowDownIcon className="size-3" />
          </button>
        </span>
      ) : null}
    </div>
  );
}

export function SortableMachineGroupHeader(props: Parameters<typeof SidebarMachineGroupHeader>[0]) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarListItemId(props.item),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      className="list-none"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      <SidebarMachineGroupHeader {...props} />
    </li>
  );
}
