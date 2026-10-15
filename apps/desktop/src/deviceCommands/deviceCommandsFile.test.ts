// @effect-diagnostics nodeBuiltinImport:off -- Real temporary filesystem fixtures verify atomic writes and symlink preservation.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
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
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "device-commands-"));
});

afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
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
    await NodeFSP.writeFile(real, '{"commands":[]}');
    await NodeFSP.symlink(real, link);
    await writeDeviceCommandsFile(link, { commands: [up] });
    expect((await NodeFSP.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readDeviceCommandsFile(real)).toEqual({ commands: [up] });
  });

  it("rejects an invalid file instead of resetting it", async () => {
    const file = NodePath.join(directory, "device-commands.json");
    await NodeFSP.writeFile(file, '{"commands":[{"id":"up"}]}');
    await expect(readDeviceCommandsFile(file)).rejects.toThrow();
    expect(await NodeFSP.readFile(file, "utf8")).toBe('{"commands":[{"id":"up"}]}');
  });

  it("drops repeated IDs so a run by ID is unambiguous", () => {
    expect(normalizeDeviceCommands([up, { ...up, name: "Other" }])).toEqual([up]);
  });
});
