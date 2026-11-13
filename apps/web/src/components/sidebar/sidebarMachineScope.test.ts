import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { parsePersistedState } from "../../uiStateStore";
import {
  normalizeSidebarMachineScope,
  sidebarMachineScopeIds,
  scopeSidebarProjectKeysToEnvironments,
  toggleSidebarMachineScope,
} from "./sidebarMachineScope";

const mac = EnvironmentId.make("mac");
const gwdg = EnvironmentId.make("gwdg");
const hub = EnvironmentId.make("hub");
const projectId = ProjectId.make("shared-project");
const refs = [mac, gwdg, hub].map((environmentId) => ({ environmentId, projectId }));

describe("machine filter persistence", () => {
  it("restores old single-machine selections and multiple-machine selections", () => {
    for (const scope of [null, "gwdg", ["mac", "gwdg"]]) {
      const restored = parsePersistedState(
        JSON.parse(JSON.stringify({ sidebarEnvironmentScopeId: scope })),
      );
      expect(restored.sidebarEnvironmentScopeId).toEqual(scope);
    }
    expect(normalizeSidebarMachineScope([" mac ", "mac", "", 4, "gwdg"])).toEqual(["mac", "gwdg"]);
    expect(sidebarMachineScopeIds("gwdg")).toEqual([gwdg]);
  });
});

describe("machine and project scope intersection", () => {
  it("includes projects from every chosen machine and excludes the others", () => {
    expect(scopeSidebarProjectKeysToEnvironments(null, [mac, gwdg], refs)).toEqual(
      new Set(["mac:shared-project", "gwdg:shared-project"]),
    );
    expect(
      scopeSidebarProjectKeysToEnvironments(
        new Set(["gwdg:shared-project", "hub:shared-project"]),
        [mac, gwdg],
        refs,
      ),
    ).toEqual(new Set(["gwdg:shared-project"]));
    expect(scopeSidebarProjectKeysToEnvironments(null, [], refs)).toBeNull();
    expect(scopeSidebarProjectKeysToEnvironments(new Set(), [mac, gwdg], refs)).toEqual(new Set());
  });

  it("toggles machines without dropping the others and returns to all after removing the last", () => {
    const both = toggleSidebarMachineScope([mac], gwdg);
    expect(both).toEqual([mac, gwdg]);
    expect(toggleSidebarMachineScope(both, mac)).toEqual([gwdg]);
    expect(normalizeSidebarMachineScope(toggleSidebarMachineScope([gwdg], gwdg))).toBeNull();
  });
});
