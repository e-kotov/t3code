import { describe, expect, it } from "vite-plus/test";
import {
  applyRunUpdate,
  findRun,
  moveDeviceCommand,
  newDeviceCommandId,
  paletteDeviceCommands,
} from "./deviceCommands.logic";
import { describeRunOutcome, formatRunAge } from "./deviceCommandsFormat";

const command = {
  id: "up",
  name: "GWDG up",
  command: "gwdg-agent up",
  icon: "server" as const,
  confirm: false,
  showInCommandPalette: true,
};
const run = {
  runId: "run-1",
  commandId: "up",
  commandName: "GWDG up",
  status: "running" as const,
  startedAt: 1000,
  finishedAt: null,
  exitCode: null,
  output: "",
  outputTruncated: false,
  error: null,
};

describe("device command presentation", () => {
  it("lets each command opt out of the palette without removing it from the saved list", () => {
    const commands = [command, { ...command, id: "stop", showInCommandPalette: false }];
    expect(paletteDeviceCommands(commands)).toEqual([command]);
    expect(commands).toHaveLength(2);
  });
  it("keeps completion when the start reply arrives after an output event", () => {
    const finished = { ...run, status: "succeeded" as const, finishedAt: 1100, exitCode: 0 };
    const current = applyRunUpdate({}, finished);
    expect(applyRunUpdate(current, run)).toBe(current);
    expect(applyRunUpdate(current, { ...run, runId: "old", startedAt: 500 })).toBe(current);
    expect(findRun(current, finished.runId)).toEqual(finished);
    expect(findRun(current, null)).toBeNull();
  });
  it("keeps command settings intact on reorder and assigns unique IDs", () => {
    const other = { ...command, id: "gwdg-up", confirm: true };
    expect(newDeviceCommandId("GWDG up", [other])).toBe("gwdg-up-2");
    expect(moveDeviceCommand([command, other], 1, 0)).toEqual([other, command]);
    expect(moveDeviceCommand([command, other], -1, 0)).toEqual([command, other]);
  });
  it("reports failures and compact ages", () => {
    expect(describeRunOutcome({ status: "failed", exitCode: 7 })).toBe("Failed with exit code 7");
    expect(formatRunAge(0, 120_000)).toBe("2m");
    expect(formatRunAge(2000, 1000)).toBe("now");
  });
});
