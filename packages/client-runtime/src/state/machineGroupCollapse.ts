import {
  isSidebarMachineGrouping,
  type SidebarConversationGrouping,
} from "@t3tools/contracts/settings";
import { Atom } from "effect/reactivity";
import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import type { EnvironmentThreadShell } from "./models.ts";

export const collapsedMachineGroupsAtom = Atom.make<readonly string[]>([]).pipe(Atom.keepAlive);

export type MachineGroupSection = "pinned" | "active" | "working" | "snoozed" | "settled";

export function machineGroupKey(environmentId: string, section: MachineGroupSection = "active") {
  return JSON.stringify([section, environmentId]);
}

export function toggleCollapsedMachineGroup(current: readonly string[], key: string) {
  return current.includes(key) ? current.filter((id) => id !== key) : [...current, key];
}

export function machineGroupThreadVisible(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
  options: {
    readonly section?: MachineGroupSection;
    readonly grouping?: string;
    readonly collapsedMachineGroups?: readonly string[];
    readonly selectedThreadKey?: string | null;
    readonly searchQuery?: string;
  },
): boolean {
  return (
    !isSidebarMachineGrouping((options.grouping ?? "none") as SidebarConversationGrouping) ||
    Boolean(options.searchQuery?.trim()) ||
    !options.collapsedMachineGroups?.includes(
      machineGroupKey(thread.environmentId, options.section),
    ) ||
    (options.selectedThreadKey != null &&
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
        options.selectedThreadKey)
  );
}
