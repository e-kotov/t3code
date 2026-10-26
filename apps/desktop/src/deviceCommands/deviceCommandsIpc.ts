import { installDeviceUtilities } from "../deviceUtilities/deviceUtilitiesIpc.ts";
import {
  DeviceCommandRun,
  DeviceCommandRunInput,
  DeviceCommandsDocument,
  DeviceCommandsState,
  DeviceCommandStopInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as Channels from "./deviceCommandsChannels.ts";
import {
  normalizeDeviceCommands,
  readDeviceCommandsFile,
  writeDeviceCommandsFile,
} from "./deviceCommandsFile.ts";
import { DeviceCommandsRunner } from "./DeviceCommandsRunner.ts";

const DEVICE_COMMANDS_FILE_NAME = "device-commands.json";

export class DeviceCommandsError extends Schema.TaggedError<DeviceCommandsError>()(
  "DeviceCommandsError",
  {
    operation: Schema.Literals(["read", "write", "run"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const causeText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const runner = new DeviceCommandsRunner();

const storagePath = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  return environment.path.join(environment.stateDir, DEVICE_COMMANDS_FILE_NAME);
});

const readState = Effect.fn("desktop.deviceCommands.read")(function* () {
  const filePath = yield* storagePath;
  const document = yield* Effect.tryPromise({
    try: () => readDeviceCommandsFile(filePath),
    catch: (cause) =>
      new DeviceCommandsError({
        operation: "read",
        detail: `Could not read ${filePath}: ${causeText(cause)}`,
      }),
  });
  return { commands: document.commands, storagePath: filePath };
});

const getState = DesktopIpc.makeIpcMethod({
  channel: Channels.DEVICE_COMMANDS_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DeviceCommandsState,
  handler: Effect.fn("desktop.ipc.deviceCommands.getState")(function* () {
    return yield* readState();
  }),
});

const save = DesktopIpc.makeIpcMethod({
  channel: Channels.DEVICE_COMMANDS_SAVE_CHANNEL,
  payload: DeviceCommandsDocument,
  result: DeviceCommandsState,
  handler: Effect.fn("desktop.ipc.deviceCommands.save")(function* (document) {
    const filePath = yield* storagePath;
    const commands = normalizeDeviceCommands(document.commands);
    yield* Effect.tryPromise({
      try: () => writeDeviceCommandsFile(filePath, { commands }),
      catch: (cause) =>
        new DeviceCommandsError({
          operation: "write",
          detail: `Could not save ${filePath}: ${causeText(cause)}`,
        }),
    });
    return { commands, storagePath: filePath };
  }),
});

const run = DesktopIpc.makeIpcMethod({
  channel: Channels.DEVICE_COMMANDS_RUN_CHANNEL,
  payload: DeviceCommandRunInput,
  result: DeviceCommandRun,
  handler: Effect.fn("desktop.ipc.deviceCommands.run")(function* ({ commandId }) {
    // The renderer names a command; its text always comes from this device's file.
    const state = yield* readState();
    const command = state.commands.find((candidate) => candidate.id === commandId);
    if (!command) {
      return yield* new DeviceCommandsError({
        operation: "run",
        detail: "This command no longer exists. Reopen the Commands menu.",
      });
    }
    return runner.start(command);
  }),
});

const stop = DesktopIpc.makeIpcMethod({
  channel: Channels.DEVICE_COMMANDS_STOP_CHANNEL,
  payload: DeviceCommandStopInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.deviceCommands.stop")(({ runId }) =>
    Effect.sync(() => runner.stop(runId)),
  ),
});

const listRuns = DesktopIpc.makeIpcMethod({
  channel: Channels.DEVICE_COMMANDS_LIST_RUNS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DeviceCommandRun),
  handler: Effect.fn("desktop.ipc.deviceCommands.listRuns")(() => Effect.sync(() => runner.runs())),
});

/** Registers the methods, forwards run updates to every window, and stops runs on quit. */
export const installDeviceCommands = Effect.fn("desktop.ipc.deviceCommands.install")(function* () {
  yield* installDeviceUtilities();
  const ipc = yield* DesktopIpc.DesktopIpc;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const unsubscribe = runner.subscribe((runUpdate) => {
    runFork(electronWindow.sendAll(Channels.DEVICE_COMMANDS_RUN_UPDATED_CHANNEL, runUpdate));
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribe();
      runner.stopAll();
    }),
  );
  yield* ipc.handle(getState);
  yield* ipc.handle(save);
  yield* ipc.handle(run);
  yield* ipc.handle(stop);
  yield* ipc.handle(listRuns);
});
