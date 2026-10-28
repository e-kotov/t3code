import type { EnvironmentThreadShell } from "./models.ts";
import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import { Atom } from "effect/reactivity";

export const collapsedMachineGroupsAtom = Atom.make<readonly string[]>([]).pipe(Atom.keepAlive);

export function toggleCollapsedMachineGroup(current: readonly string[], environmentId: string) {
  return current.includes(environmentId)
    ? current.filter((id) => id !== environmentId)
    : [...current, environmentId];
}

export function machineGroupThreadVisible(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
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
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === options.selectedThreadKey)
  );
}
