import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  appendDeviceCommandOutput,
  DeviceCommandsDocument,
  finishedDeviceCommandStatus,
} from "./deviceCommands.ts";

describe("device commands contract", () => {
  it("fills defaults for commands saved with only the required fields", () => {
    const decoded = Schema.decodeUnknownSync(DeviceCommandsDocument)({
      commands: [{ id: "up", name: "GWDG up", command: "gwdg-agent up" }],
    });
    expect(decoded.commands[0]).toEqual({
      id: "up",
      name: "GWDG up",
      command: "gwdg-agent up",
      icon: "terminal",
      confirm: false,
      showInCommandPalette: true,
    });
  });

  it("rejects a command without text", () => {
    expect(() =>
      Schema.decodeUnknownSync(DeviceCommandsDocument)({
        commands: [{ id: "up", name: "GWDG up", command: "  " }],
      }),
    ).toThrow();
  });

  it("keeps the newest output when the limit is exceeded", () => {
    const first = appendDeviceCommandOutput({ output: "", outputTruncated: false }, "abc", 5);
    expect(first).toEqual({ output: "abc", outputTruncated: false });
    const second = appendDeviceCommandOutput(first, "defg", 5);
    expect(second).toEqual({ output: "cdefg", outputTruncated: true });
  });

  it("reports a stopped run as stopped even when the process exits non-zero", () => {
    expect(finishedDeviceCommandStatus({ exitCode: 143, stopRequested: true })).toBe("stopped");
    expect(finishedDeviceCommandStatus({ exitCode: 0, stopRequested: false })).toBe("succeeded");
    expect(finishedDeviceCommandStatus({ exitCode: null, stopRequested: false })).toBe("failed");
  });
});
