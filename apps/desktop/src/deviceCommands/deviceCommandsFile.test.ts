import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  normalizeDeviceCommands,
  readDeviceCommandsFile,
  writeDeviceCommandsFile,
} from "./deviceCommandsFile.ts";

const up = {
  id: "up",
  name: "GWDG up",
  command: "gwdg-agent up",
  icon: "server" as const,
  confirm: false,
  showInCommandPalette: true,
};

let directory: string;

beforeEach(async () => {
  directory = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "device-commands-"));
});

afterEach(async () => {
  await NodeFs.rm(directory, { recursive: true, force: true });
});

describe("device commands file", () => {
  it("treats a missing file as an empty list and round-trips a saved one", async () => {
    const file = NodePath.join(directory, "nested", "device-commands.json");
    expect(await readDeviceCommandsFile(file)).toEqual({ commands: [] });
    await writeDeviceCommandsFile(file, { commands: [up] });
    expect(await readDeviceCommandsFile(file)).toEqual({ commands: [up] });
  });

  it("keeps a symlinked file a symlink when saving", async () => {
    const real = NodePath.join(directory, "real.json");
    const link = NodePath.join(directory, "device-commands.json");
    await NodeFs.writeFile(real, '{"commands":[]}');
    await NodeFs.symlink(real, link);
    await writeDeviceCommandsFile(link, { commands: [up] });
    expect((await NodeFs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readDeviceCommandsFile(real)).toEqual({ commands: [up] });
  });

  it("rejects an invalid file instead of resetting it", async () => {
    const file = NodePath.join(directory, "device-commands.json");
    await NodeFs.writeFile(file, '{"commands":[{"id":"up"}]}');
    await expect(readDeviceCommandsFile(file)).rejects.toThrow();
    expect(await NodeFs.readFile(file, "utf8")).toBe('{"commands":[{"id":"up"}]}');
  });

  it("drops repeated IDs so a run by ID is unambiguous", () => {
    expect(normalizeDeviceCommands([up, { ...up, name: "Other" }])).toEqual([up]);
  });
});
