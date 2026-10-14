import { describe, expect, it } from "vite-plus/test";

import { machineGroupConnectionStatus } from "./machineGroupStatus.ts";
import type { EnvironmentConnectionPhase } from "./presentation.ts";

describe("machine group connection status", () => {
  it("tracks retry, recovery, and another disconnect without leaving a stale indicator", () => {
    const phases: EnvironmentConnectionPhase[] = [
      "connected",
      "reconnecting",
      "connected",
      "offline",
      "connecting",
      "connected",
    ];
    expect(phases.map((phase) => machineGroupConnectionStatus("GWDG", phase))).toEqual([
      null,
      { label: "GWDG is reconnecting", pulse: true },
      null,
      { label: "GWDG is offline", pulse: false },
      { label: "GWDG is connecting", pulse: true },
      null,
    ]);
  });

  it("identifies the affected machine independently of healthy groups", () => {
    expect(machineGroupConnectionStatus("Mac", "connected")).toBeNull();
    expect(machineGroupConnectionStatus("GWDG", "reconnecting")).toEqual({
      label: "GWDG is reconnecting",
      pulse: true,
    });
    expect(machineGroupConnectionStatus("Phone", undefined)).toBeNull();
  });

  it.each([
    ["available", "GWDG is not connected"],
    ["offline", "GWDG is offline"],
    ["error", "Connection to GWDG failed"],
    ["unsupported", "GWDG requires a compatible client"],
  ] as const)("does not imply automatic retries for %s", (phase, label) => {
    expect(machineGroupConnectionStatus("GWDG", phase)).toEqual({ label, pulse: false });
  });
});
