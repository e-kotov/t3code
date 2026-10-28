import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import { Atom } from "effect/reactivity";

export const collapsedMachineGroupsAtom = Atom.make<readonly string[]>([]).pipe(Atom.keepAlive);

export function toggleCollapsedMachineGroup(current: readonly string[], environmentId: string) {
  return current.includes(environmentId)
    ? current.filter((id) => id !== environmentId)
    : [...current, environmentId];
}

export function machineGroupThreadVisible(
  thread: { readonly environmentId: string; readonly id: string },
  options: {
    readonly grouping?: string;
    readonly collapsedMachineGroups?: readonly string[];
    readonly selectedThreadKey?: string | null;
    readonly searchQuery?: string;
  },
): boolean {
  return (
    options.grouping !== "machine" ||
    Boolean(options.searchQuery?.trim()) ||
    !options.collapsedMachineGroups?.includes(thread.environmentId) ||
    (options.selectedThreadKey != null &&
      scopedThreadKey(
        scopeThreadRef(EnvironmentId.make(thread.environmentId), ThreadId.make(thread.id)),
      ) === options.selectedThreadKey)
  );
}
