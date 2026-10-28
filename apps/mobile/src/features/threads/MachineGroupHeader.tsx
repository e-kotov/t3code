import { EnvironmentId, type EnvironmentMachineKind } from "@t3tools/contracts";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { CacheWarmingMachineControl } from "./CacheWarmingControls";
import type { ThreadListV2MachineHeaderListItem } from "./conversationListOrder";
import { MachineGroupConnectionStatus } from "./MachineGroupConnectionStatus";
import { MachineGroupSlurmTime } from "./MachineGroupSlurmTime";
import { ThreadListV2Section } from "./thread-list-v2-items";

import { useMachineGroupCollapse } from "./machineGroupCollapse";

type MoveMachine = (environmentId: string, delta: -1 | 1) => void;

/** Renders a `v2-machine-header` row for the Home list and the sidebar. */
export function renderMachineGroupHeader(
  item: ThreadListV2MachineHeaderListItem,
  pane: "screen" | "sidebar",
  onMove: MoveMachine,
) {
  return (
    <ThreadListV2MachineHeader
      label={item.label}
      pane={pane}
      environmentId={item.environmentId}
      position={item.position}
      count={item.count}
      onMove={onMove}
      machineKind={item.machineKind}
      collapsible={item.collapsible}
    />
  );
}

const ThreadListV2MachineHeader = memo(function ThreadListV2MachineHeader(props: {
  readonly label: string;
  readonly pane?: "screen" | "sidebar";
  readonly environmentId?: string;
  readonly position?: number;
  readonly count?: number;
  readonly onMove?: MoveMachine;
  readonly machineKind?: EnvironmentMachineKind;
  readonly collapsible?: boolean;
}) {
  const { environmentId, position, count, onMove } = props;
  const { collapsedMachineGroups, toggleMachineGroup } = useMachineGroupCollapse();
  const collapsed = environmentId !== undefined && collapsedMachineGroups.includes(environmentId);
  return (
    <View className={cn("flex-row items-center", props.pane === "sidebar" ? "px-3" : "px-5")}>
      <MachineGroupConnectionStatus environmentId={environmentId} />
      {props.machineKind ? (
        <EnvironmentMachineSymbol
          kind={props.machineKind}
          size={13}
          tintColorClassName="accent-foreground-muted"
        />
      ) : null}
      <View className="flex-1">
        <ThreadListV2Section
          label={
            <>
              {props.label}
              <MachineGroupSlurmTime environmentId={environmentId} />
            </>
          }
          pane={props.pane}
          accessory={
            <>
              {environmentId ? (
                <CacheWarmingMachineControl environmentId={EnvironmentId.make(environmentId)} />
              ) : null}
              {environmentId && position !== undefined && count !== undefined && onMove
                ? ([-1, 1] as const).map((delta) => {
                    const disabled = delta < 0 ? position === 0 : position === count - 1;
                    return (
                      <Pressable
                        key={delta}
                        accessibilityRole="button"
                        accessibilityLabel={`Move machine group ${delta < 0 ? "up" : "down"}`}
                        accessibilityState={{ disabled }}
                        disabled={disabled}
                        hitSlop={8}
                        onPress={() => onMove(environmentId, delta)}
                      >
                        <SymbolView
                          name={delta < 0 ? "chevron.up" : "chevron.down"}
                          size={12}
                          tintColorClassName="accent-foreground-muted"
                          type="monochrome"
                        />
                      </Pressable>
                    );
                  })
                : null}
              {environmentId && props.collapsible ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={collapsed ? "Expand machine group" : "Collapse machine group"}
                  accessibilityState={{ expanded: !collapsed }}
                  hitSlop={8}
                  onPress={() => toggleMachineGroup(environmentId)}
                >
                  <SymbolView
                    name={collapsed ? "chevron.right" : "chevron.down"}
                    size={12}
                    tintColorClassName="accent-foreground-muted"
                    type="monochrome"
                  />
                </Pressable>
              ) : null}
            </>
          }
        />
      </View>
    </View>
  );
});
