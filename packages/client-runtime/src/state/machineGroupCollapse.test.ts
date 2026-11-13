import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import {
  collapsedMachineGroupsAtom,
  machineGroupKey,
  machineGroupThreadVisible,
  toggleCollapsedMachineGroup,
} from "./machineGroupCollapse.ts";

describe("machine group visibility", () => {
  const thread = { environmentId: EnvironmentId.make("mac"), id: ThreadId.make("same-id") };
  const folded = { grouping: "machine", collapsedMachineGroups: [machineGroupKey("mac")] };

  it("keeps only the selected scoped conversation when its machine is folded", () => {
    expect(machineGroupThreadVisible(thread, folded)).toBe(false);
    const selectedThreadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    expect(machineGroupThreadVisible(thread, { ...folded, selectedThreadKey })).toBe(true);
    expect(
      machineGroupThreadVisible(thread, { ...folded, selectedThreadKey: "other:same-id" }),
    ).toBe(false);
  });

  it("reveals search results and ungrouped rows without clearing the fold", () => {
    expect(machineGroupThreadVisible(thread, { ...folded, searchQuery: "needle" })).toBe(true);
    expect(machineGroupThreadVisible(thread, { ...folded, searchQuery: "   " })).toBe(false);
    expect(machineGroupThreadVisible(thread, { ...folded, grouping: "none" })).toBe(true);
    expect(machineGroupThreadVisible(thread, { ...folded, grouping: "project" })).toBe(true);
    expect(machineGroupThreadVisible(thread, { ...folded, grouping: "both" })).toBe(false);
  });

  it("folds each shelf independently and can unfold one while the others stay folded", () => {
    const pinned = machineGroupKey("mac", "pinned");
    const working = machineGroupKey("mac", "working");
    let collapsedMachineGroups = toggleCollapsedMachineGroup([], pinned);
    for (const section of ["pinned", "active", "working", "snoozed", "settled"] as const) {
      expect(
        machineGroupThreadVisible(thread, { grouping: "both", section, collapsedMachineGroups }),
      ).toBe(section !== "pinned");
    }
    collapsedMachineGroups = toggleCollapsedMachineGroup(collapsedMachineGroups, working);
    collapsedMachineGroups = toggleCollapsedMachineGroup(collapsedMachineGroups, pinned);
    expect(collapsedMachineGroups).toEqual([working]);
    expect(
      machineGroupThreadVisible(thread, {
        grouping: "machine",
        section: "working",
        collapsedMachineGroups,
      }),
    ).toBe(false);
    expect(
      machineGroupThreadVisible(thread, {
        grouping: "machine",
        section: "pinned",
        collapsedMachineGroups,
      }),
    ).toBe(true);
    expect(machineGroupKey("x:y", "pinned")).not.toBe(machineGroupKey("y", "active"));
  });

  it("shares fold state within a client registry while keeping clients independent", () => {
    const client = AtomRegistry.make();
    const otherClient = AtomRegistry.make();
    try {
      const unsubscribe = client.subscribe(collapsedMachineGroupsAtom, () => {});
      client.set(
        collapsedMachineGroupsAtom,
        toggleCollapsedMachineGroup(client.get(collapsedMachineGroupsAtom), machineGroupKey("mac")),
      );
      client.set(
        collapsedMachineGroupsAtom,
        toggleCollapsedMachineGroup(
          client.get(collapsedMachineGroupsAtom),
          machineGroupKey("gwdg"),
        ),
      );
      unsubscribe();
      expect(client.get(collapsedMachineGroupsAtom)).toEqual([
        machineGroupKey("mac"),
        machineGroupKey("gwdg"),
      ]);
      expect(otherClient.get(collapsedMachineGroupsAtom)).toEqual([]);
      client.set(
        collapsedMachineGroupsAtom,
        toggleCollapsedMachineGroup(client.get(collapsedMachineGroupsAtom), machineGroupKey("mac")),
      );
      expect(client.get(collapsedMachineGroupsAtom)).toEqual([machineGroupKey("gwdg")]);
    } finally {
      client.dispose();
      otherClient.dispose();
    }
  });
});
