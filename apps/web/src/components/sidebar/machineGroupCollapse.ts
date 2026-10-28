import { useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

const collapsedMachineGroupsAtom = Atom.make<readonly string[]>([]).pipe(Atom.keepAlive);

export function useMachineGroupCollapse() {
  const [collapsedMachineGroups, setCollapsedMachineGroups] = useAtom(collapsedMachineGroupsAtom);
  const toggleMachineGroup = (environmentId: string) => {
    setCollapsedMachineGroups((current) =>
      current.includes(environmentId)
        ? current.filter((id) => id !== environmentId)
        : [...current, environmentId],
    );
  };
  return { collapsedMachineGroups, toggleMachineGroup };
}
