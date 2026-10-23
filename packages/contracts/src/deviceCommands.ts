import type { DeviceUtilitiesBridge } from "./deviceUtilities.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Device commands are user-defined shell commands that run on the device the
 * user taps them on: the Mac through the desktop shell, Android through Termux.
 * They are stored only on that device and never in server settings, so no
 * connected environment or agent can change what runs locally.
 */

/** Combined stdout/stderr kept per run; older output is dropped from the start. */
const DEVICE_COMMAND_OUTPUT_LIMIT = 100_000;
export const DEVICE_COMMANDS_MAX_COUNT = 50;

export const DeviceCommandIcon = Schema.Literals([
  "play",
  "stop",
  "terminal",
  "server",
  "refresh",
  "power",
  "plug",
  "wrench",
]);
export type DeviceCommandIcon = typeof DeviceCommandIcon.Type;
export const DEVICE_COMMAND_ICONS: ReadonlyArray<DeviceCommandIcon> = DeviceCommandIcon.literals;

export const DeviceCommand = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: DeviceCommandIcon.pipe(Schema.withDecodingDefault(Effect.succeed("terminal" as const))),
  /** Ask before running, for commands such as cancelling a job. */
  confirm: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Desktop only: list the command in the command palette. */
  showInCommandPalette: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type DeviceCommand = typeof DeviceCommand.Type;

export const DeviceCommandList = Schema.Array(DeviceCommand).check(
  Schema.isMaxLength(DEVICE_COMMANDS_MAX_COUNT),
);
export type DeviceCommandList = typeof DeviceCommandList.Type;

export const DeviceCommandsDocument = Schema.Struct({
  commands: DeviceCommandList,
});
export type DeviceCommandsDocument = typeof DeviceCommandsDocument.Type;

/** The stored list plus where it lives, so Settings can show the file. */
export const DeviceCommandsState = Schema.Struct({
  commands: DeviceCommandList,
  storagePath: Schema.NullOr(Schema.String),
});
export type DeviceCommandsState = typeof DeviceCommandsState.Type;

export const DeviceCommandRunStatus = Schema.Literals([
  "running",
  "succeeded",
  "failed",
  "stopped",
]);
export type DeviceCommandRunStatus = typeof DeviceCommandRunStatus.Type;

export const DeviceCommandRun = Schema.Struct({
  runId: TrimmedNonEmptyString,
  commandId: TrimmedNonEmptyString,
  commandName: Schema.String,
  status: DeviceCommandRunStatus,
  startedAt: NonNegativeInt,
  finishedAt: Schema.NullOr(NonNegativeInt),
  exitCode: Schema.NullOr(Schema.Int),
  /** Combined output, capped at DEVICE_COMMAND_OUTPUT_LIMIT characters. */
  output: Schema.String,
  outputTruncated: Schema.Boolean,
  /** Why the run could not start or was cut short, separate from command output. */
  error: Schema.NullOr(Schema.String),
});
export type DeviceCommandRun = typeof DeviceCommandRun.Type;

export const DeviceCommandRunInput = Schema.Struct({ commandId: TrimmedNonEmptyString });
export const DeviceCommandStopInput = Schema.Struct({ runId: TrimmedNonEmptyString });

/** Desktop bridge group. Optional on DesktopBridge: older desktop builds lack it. */
export interface DeviceCommandsBridge {
  readonly utilities?: DeviceUtilitiesBridge;
  readonly getState: () => Promise<DeviceCommandsState>;
  readonly save: (document: DeviceCommandsDocument) => Promise<DeviceCommandsState>;
  /** Runs a stored command by ID; the command text is read from the device's own file. */
  readonly run: (commandId: string) => Promise<DeviceCommandRun>;
  readonly stop: (runId: string) => Promise<void>;
  readonly listRuns: () => Promise<ReadonlyArray<DeviceCommandRun>>;
  readonly onRun: (listener: (run: DeviceCommandRun) => void) => () => void;
}

/** Appends output while keeping only the newest `limit` characters. */
export function appendDeviceCommandOutput(
  current: { readonly output: string; readonly outputTruncated: boolean },
  chunk: string,
  limit: number = DEVICE_COMMAND_OUTPUT_LIMIT,
): { readonly output: string; readonly outputTruncated: boolean } {
  const combined = current.output + chunk;
  if (combined.length <= limit) {
    return { output: combined, outputTruncated: current.outputTruncated };
  }
  return { output: combined.slice(combined.length - limit), outputTruncated: true };
}

/** Status for a finished process: a stop request wins over the exit code it causes. */
export function finishedDeviceCommandStatus(input: {
  readonly exitCode: number | null;
  readonly stopRequested: boolean;
}): Exclude<DeviceCommandRunStatus, "running"> {
  if (input.stopRequested) return "stopped";
  return input.exitCode === 0 ? "succeeded" : "failed";
}
