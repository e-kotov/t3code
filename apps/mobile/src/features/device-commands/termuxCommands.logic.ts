import { DeviceCommandList, DeviceCommandRun, type DeviceCommand } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const decodeTermuxState = Schema.decodeUnknownSync(
  Schema.Struct({
    installed: Schema.Boolean,
    permissionGranted: Schema.Boolean,
    commands: DeviceCommandList,
    runs: Schema.Array(DeviceCommandRun),
  }),
);

export function latestDeviceCommandRuns(runs: ReadonlyArray<DeviceCommandRun>) {
  const latest: Record<string, DeviceCommandRun> = {};
  for (const run of runs) {
    const previous = latest[run.commandId];
    if (!previous || previous.startedAt <= run.startedAt) latest[run.commandId] = run;
  }
  return latest;
}

export function createDeviceCommand(commands: ReadonlyArray<DeviceCommand>): DeviceCommand {
  const ids = new Set(commands.map((command) => command.id));
  let suffix = 1;
  while (ids.has(`command-${suffix}`)) suffix += 1;
  return {
    id: `command-${suffix}`,
    name: "",
    command: "",
    icon: "terminal",
    confirm: false,
    showInCommandPalette: false,
  };
}

export function reorderDeviceCommand<T>(items: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
