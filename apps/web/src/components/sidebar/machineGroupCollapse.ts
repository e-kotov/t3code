import { useAtom } from "@effect/atom-react";
import {
  collapsedMachineGroupsAtom,
  machineGroupKey,
  type MachineGroupSection,
  toggleCollapsedMachineGroup,
} from "@t3tools/client-runtime/state/machine-group-collapse";

export function useMachineGroupCollapse() {
  const [collapsedMachineGroups, setCollapsedMachineGroups] = useAtom(collapsedMachineGroupsAtom);
  const toggleMachineGroup = (environmentId: string, section: MachineGroupSection = "active") => {
    setCollapsedMachineGroups((current) => toggleCollapsedMachineGroup(current, machineGroupKey(environmentId, section)));
  };
  return { collapsedMachineGroups, toggleMachineGroup };
}
