// @effect-diagnostics nodeBuiltinImport:off -- This desktop file adapter implements atomic replacement while preserving existing filesystem symlinks.
import * as NodeCrypto from "node:crypto";
import { DeviceCommandsDocument, type DeviceCommand } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const decodeDocument = Schema.decodeUnknownSync(DeviceCommandsDocument);

/** A missing file is an empty list; an invalid one is an error and is never reset. */
export async function readDeviceCommandsFile(filePath: string): Promise<DeviceCommandsDocument> {
  let raw: string;
  try {
    raw = await NodeFSP.readFile(filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { commands: [] };
    throw cause;
  }
  return decodeDocument(JSON.parse(raw));
}

/** Writes atomically, following a symlink so a dotfile-managed link stays a link. */
export async function writeDeviceCommandsFile(
  filePath: string,
  document: DeviceCommandsDocument,
): Promise<void> {
  const target = await NodeFSP.realpath(filePath).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return filePath;
    throw cause;
  });
  await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
  const temporary = `${target}.${NodeCrypto.randomUUID()}.tmp`;
  await NodeFSP.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await NodeFSP.rename(temporary, target);
}

/** Drops repeated IDs, keeping the first, so a run by ID is never ambiguous. */
export function normalizeDeviceCommands(
  commands: ReadonlyArray<DeviceCommand>,
): ReadonlyArray<DeviceCommand> {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}
