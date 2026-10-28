import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import {
  collapsedMachineGroupsAtom,
  machineGroupThreadVisible,
  toggleCollapsedMachineGroup,
} from "./machineGroupCollapse.ts";

describe("machine group visibility", () => {
  const thread = { environmentId: "mac", id: "same-id" };
  const folded = { grouping: "machine", collapsedMachineGroups: ["mac"] };

  it("keeps only the selected scoped conversation when its machine is folded", () => {
    expect(machineGroupThreadVisible(thread, folded)).toBe(false);
    const selectedThreadKey = scopedThreadKey(
      scopeThreadRef(EnvironmentId.make(thread.environmentId), ThreadId.make(thread.id)),
    );
    expect(machineGroupThreadVisible(thread, { ...folded, selectedThreadKey })).toBe(true);
    expect(
      machineGroupThreadVisible(thread, { ...folded, selectedThreadKey: "other:same-id" }),
    ).toBe(false);
  });

  it("reveals search results and ungrouped rows without clearing the fold", () => {
    expect(machineGroupThreadVisible(thread, { ...folded, searchQuery: "needle" })).toBe(true);
    expect(machineGroupThreadVisible(thread, { ...folded, searchQuery: "   " })).toBe(false);
    expect(machineGroupThreadVisible(thread, { ...folded, grouping: "none" })).toBe(true);
  });

  it("shares fold state within a client registry while keeping clients independent", () => {
    const client = AtomRegistry.make();
    const otherClient = AtomRegistry.make();
    try {
      const unsubscribe = client.subscribe(collapsedMachineGroupsAtom, () => {});
      client.set(
        collapsedMachineGroupsAtom,
        toggleCollapsedMachineGroup(client.get(collapsedMachineGroupsAtom), "mac"),
      );
      client.set(
        collapsedMachineGroupsAtom,
        toggleCollapsedMachineGroup(client.get(collapsedMachineGroupsAtom), "gwdg"),
      );
      unsubscribe();
      expect(client.get(collapsedMachineGroupsAtom)).toEqual(["mac", "gwdg"]);
      expect(otherClient.get(collapsedMachineGroupsAtom)).toEqual([]);
      client.set(
        collapsedMachineGroupsAtom,
        toggleCollapsedMachineGroup(client.get(collapsedMachineGroupsAtom), "mac"),
      );
      expect(client.get(collapsedMachineGroupsAtom)).toEqual(["gwdg"]);
    } finally {
      client.dispose();
      otherClient.dispose();
    }
  });
});
