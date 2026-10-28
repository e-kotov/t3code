import { useAtom } from "@effect/atom-react";
import {
  collapsedMachineGroupsAtom,
  toggleCollapsedMachineGroup,
} from "@t3tools/client-runtime/state/machine-group-collapse";

export function useMachineGroupCollapse() {
  const [collapsedMachineGroups, setCollapsedMachineGroups] = useAtom(collapsedMachineGroupsAtom);
  const toggleMachineGroup = (environmentId: string) => {
    setCollapsedMachineGroups((current) => toggleCollapsedMachineGroup(current, environmentId));
  };
  return { collapsedMachineGroups, toggleMachineGroup };
}
