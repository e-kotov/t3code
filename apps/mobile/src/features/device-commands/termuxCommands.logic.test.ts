import { describe, expect, it } from "vite-plus/test";
import {
  createDeviceCommand,
  decodeTermuxState,
  latestDeviceCommandRuns,
  reorderDeviceCommand,
} from "./termuxCommands.logic";

describe("Termux commands", () => {
  it("rejects corrupt native state rather than allowing a broken command to run", () => {
    expect(() =>
      decodeTermuxState({
        installed: true,
        permissionGranted: true,
        commands: [{ id: "up", name: "Up" }],
        runs: [],
      }),
    ).toThrow();
  });
  it("allocates stable unique IDs after deletions and preserves settings while reordering", () => {
    const first = {
      ...createDeviceCommand([]),
      name: "Up",
      command: "gwdg-agent up",
      confirm: true,
    };
    const second = createDeviceCommand([first]);
    expect(createDeviceCommand([second]).id).toBe(first.id);
    expect(reorderDeviceCommand([first, second], 0, 1)).toEqual([second, first]);
    expect(reorderDeviceCommand([first, second], 0, -1)).toEqual([first, second]);
  });
  it("keeps a newer run when an older Termux result arrives late", () => {
    const base = {
      commandId: "up",
      commandName: "Up",
      status: "running" as const,
      startedAt: 10,
      finishedAt: null,
      exitCode: null,
      output: "",
      outputTruncated: false,
      error: null,
    };
    const newer = { ...base, runId: "new", startedAt: 20 };
    const older = { ...base, runId: "old", status: "succeeded" as const };
    expect(latestDeviceCommandRuns([newer, older]).up).toEqual(newer);
  });
});
