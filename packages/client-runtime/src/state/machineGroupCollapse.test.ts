import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import {
  collapsedMachineGroupsAtom,
  machineGroupThreadVisible,
  toggleCollapsedMachineGroup,
} from "./machineGroupCollapse";

describe("machine group visibility", () => {
  const thread = { environmentId: "mac", id: "same-id" };
  const folded = { grouping: "machine", collapsedMachineGroups: ["mac"] };

  it("keeps only the selected scoped conversation when its machine is folded", () => {
    expect(machineGroupThreadVisible(thread, folded)).toBe(false);
    expect(machineGroupThreadVisible(thread, { ...folded, selectedThreadKey: "mac:same-id" })).toBe(true);
    expect(machineGroupThreadVisible(thread, { ...folded, selectedThreadKey: "other:same-id" })).toBe(false);
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
      client.set(collapsedMachineGroupsAtom, (current) => toggleCollapsedMachineGroup(current, "mac"));
      client.set(collapsedMachineGroupsAtom, (current) => toggleCollapsedMachineGroup(current, "gwdg"));
      unsubscribe();
      expect(client.get(collapsedMachineGroupsAtom)).toEqual(["mac", "gwdg"]);
      expect(otherClient.get(collapsedMachineGroupsAtom)).toEqual([]);
      client.set(collapsedMachineGroupsAtom, (current) => toggleCollapsedMachineGroup(current, "mac"));
      expect(client.get(collapsedMachineGroupsAtom)).toEqual(["gwdg"]);
    } finally {
      client.dispose();
      otherClient.dispose();
    }
  });
});
