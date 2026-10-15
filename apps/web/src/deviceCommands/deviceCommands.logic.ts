import type { DeviceCommand, DeviceCommandRun } from "@t3tools/contracts";

export type RunsByCommandId = Readonly<Record<string, DeviceCommandRun>>;

/** Keeps the newest run per command; updates to the same run replace it. */
export function applyRunUpdate(current: RunsByCommandId, run: DeviceCommandRun): RunsByCommandId {
  const existing = current[run.commandId];
  if (existing?.runId === run.runId && existing.status !== "running" && run.status === "running") {
    return current;
  }
  if (existing && existing.runId !== run.runId && existing.startedAt > run.startedAt) {
    return current;
  }
  return { ...current, [run.commandId]: run };
}

export function findRun(runs: RunsByCommandId, runId: string | null): DeviceCommandRun | null {
  if (!runId) return null;
  return Object.values(runs).find((run) => run.runId === runId) ?? null;
}

/** New ID for an added command: readable, and unique within the list. */
export function newDeviceCommandId(
  name: string,
  existing: ReadonlyArray<Pick<DeviceCommand, "id">>,
): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "command";
  const taken = new Set(existing.map((command) => command.id));
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  return candidate;
}

export function moveDeviceCommand<T>(items: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function paletteDeviceCommands(commands: ReadonlyArray<DeviceCommand>) {
  return commands.filter((command) => command.showInCommandPalette);
}
